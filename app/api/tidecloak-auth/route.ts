import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const TIDECLOAK_INTERNAL_URL = process.env.TIDECLOAK_INTERNAL_URL || 'http://tidecloak:8080';
const TIDECLOAK_LOCAL_URL = process.env.NEXT_PUBLIC_TIDECLOAK_URL || 'http://localhost:8080';
const REALM = process.env.TIDECLOAK_REALM || 'blindvault-realm';
const CLIENT_ID = process.env.TIDECLOAK_CLIENT_ID || 'blindvault-client';
const CLIENT_SECRET = process.env.TIDECLOAK_CLIENT_SECRET || 'blindvault-secret-2026';

// ---------------------------------------------------------------------------
// Secondary passphrase config (config/judge-credentials.json)
// Re-read on every login so edits apply without restarting / rebuilding.
// ---------------------------------------------------------------------------
type JudgeCredential = { displayName?: string; passphrase: string; tidecloakPassword?: string };

function loadJudgeCredentials(): Record<string, JudgeCredential> | null {
  const file =
    process.env.JUDGE_CREDENTIALS_FILE || path.join(process.cwd(), 'config', 'judge-credentials.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw?.judges || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simulated session revocation store (in-memory, survives HMR via globalThis).
// Used so /logout is provable even when TideCloak runs in fallback mode:
// after logout, /introspect -> active:false, /refresh & /userinfo -> rejected.
// ---------------------------------------------------------------------------
const revoked: Set<string> =
  ((globalThis as any).__bvRevokedTokens ??= new Set<string>());

function isRevoked(token?: string) {
  return Boolean(token) && revoked.has(token as string);
}

// Helper to resolve candidate base URLs (handles Docker internal network + localhost + /auth/realms vs /realms)
function getCandidateEndpoints(subpath: string): string[] {
  const bases = [TIDECLOAK_INTERNAL_URL, TIDECLOAK_LOCAL_URL];
  const urls: string[] = [];
  for (const base of bases) {
    urls.push(`${base}/realms/${REALM}/protocol/openid-connect${subpath}`);
    urls.push(`${base}/auth/realms/${REALM}/protocol/openid-connect${subpath}`);
  }
  return urls;
}

async function callTideCloakOIDC(
  subpath: string,
  options: RequestInit
): Promise<{ ok: boolean; status: number; data: any; endpointUsed: string }> {
  const urls = getCandidateEndpoints(subpath);
  let lastError: any = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(1500) });
      if (res.status === 404) continue; // Try the next path variant (/realms vs /auth/realms)
      if (res.status === 204) {
        return { ok: true, status: 204, data: { status: '204 No Content (Session Invalidated)' }, endpointUsed: url };
      }
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return { ok: res.ok, status: res.status, data: parsed, endpointUsed: url };
    } catch (err: any) {
      lastError = err;
    }
  }

  throw new Error(lastError?.message || 'TideCloak server unreachable on port 8080');
}

// Create deterministic fallback JWT if container is still booting up during demo
function buildFallbackTokenResponse(username: string) {
  const now = Math.floor(Date.now() / 1000);
  const judgeProfiles: Record<string, { name: string; given: string; family: string; email: string }> = {
    judge1: { name: 'Dr. Evelyn Vance', given: 'Evelyn', family: 'Vance', email: 'evelyn.vance@blindvault.org' },
    judge2: { name: 'Prof. Marcus Thorne', given: 'Marcus', family: 'Thorne', email: 'marcus.thorne@blindvault.org' },
    judge3: { name: 'Dr. Linh Nguyen', given: 'Linh', family: 'Nguyen', email: 'linh.nguyen@blindvault.org' },
  };
  const profile = judgeProfiles[username] || judgeProfiles.judge3;
  const payload = {
    exp: now + 300,
    iat: now,
    jti: `tc-jwt-${Date.now()}`,
    iss: `http://localhost:8080/auth/realms/${REALM}`,
    sub: `uid-${username}-2026`,
    typ: 'Bearer',
    azp: CLIENT_ID,
    session_state: `sess-${Math.random().toString(36).slice(2, 10)}`,
    preferred_username: username,
    name: profile.name,
    given_name: profile.given,
    family_name: profile.family,
    email: profile.email,
    email_verified: true,
    realm_access: {
      roles: ['_tide_message.selfencrypt', '_tide_message.selfdecrypt', 'committee_judge'],
    },
    scope: 'openid profile email',
  };
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigB64 = Buffer.from(`tidecloak-emergent-sig-${Date.now()}`).toString('base64url');
  const accessToken = `${headerB64}.${payloadB64}.${sigB64}`;
  const refreshToken = `rt.${payloadB64}.${sigB64}`;

  return {
    tokenResponse: {
      access_token: accessToken,
      expires_in: 300,
      refresh_expires_in: 1800,
      refresh_token: refreshToken,
      token_type: 'bearer',
      'not-before-policy': 0,
      session_state: payload.session_state,
      scope: 'profile email',
    },
    decodedPayload: payload,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // 1. OBTAIN ACCESS TOKEN: POST /protocol/openid-connect/token (grant_type=password)
  if (action === 'TOKEN_PASSWORD') {
    const { username = '', password = '' } = body;

    // Step A: verify the judge's secondary passphrase from config/judge-credentials.json
    const creds = loadJudgeCredentials();
    if (!creds) {
      return NextResponse.json(
        {
          liveServer: false,
          endpoint: 'config/judge-credentials.json',
          error: {
            error: 'server_misconfigured',
            error_description: 'config/judge-credentials.json not found or invalid JSON',
          },
        },
        { status: 503 }
      );
    }
    const cred = creds[username];
    if (!cred || !cred.passphrase || password !== cred.passphrase) {
      return NextResponse.json(
        {
          liveServer: false,
          endpoint: 'config/judge-credentials.json',
          error: { error: 'invalid_grant', error_description: 'Invalid username or secondary passphrase' },
        },
        { status: 401 }
      );
    }

    // Step B: passphrase OK -> exchange for a TideCloak token using the realm password (server-side only)
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username,
      password: cred.tidecloakPassword || 'password',
    });

    try {
      const result = await callTideCloakOIDC('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });

      if (result.ok && result.data?.access_token) {
        // Also fetch /userinfo if available
        let userInfo = null;
        try {
          const uiRes = await callTideCloakOIDC('/userinfo', {
            method: 'GET',
            headers: { Authorization: `Bearer ${result.data.access_token}` },
          });
          if (uiRes.ok) userInfo = uiRes.data;
        } catch {}

        return NextResponse.json({
          liveServer: true,
          endpoint: result.endpointUsed,
          tokenData: result.data,
          userInfo,
        });
      }
      // If invalid credentials on live server, return actual 401 error
      if (result.status === 401 || result.status === 400) {
        return NextResponse.json(
          { liveServer: true, endpoint: result.endpointUsed, error: result.data },
          { status: result.status }
        );
      }
    } catch (err) {
      // Fallback if container is still starting
    }

    // Fallback if container is warming up (secondary passphrase already verified above)
    const fb = buildFallbackTokenResponse(username);
    return NextResponse.json({
      liveServer: false,
      endpoint: `http://localhost:8080/auth/realms/${REALM}/protocol/openid-connect/token`,
      tokenData: fb.tokenResponse,
      userInfo: {
        sub: fb.decodedPayload.sub,
        email_verified: true,
        name: fb.decodedPayload.name,
        preferred_username: fb.decodedPayload.preferred_username,
        given_name: fb.decodedPayload.given_name,
        family_name: fb.decodedPayload.family_name,
        email: fb.decodedPayload.email,
        roles: fb.decodedPayload.realm_access.roles,
      },
    });
  }

  // 2. REFRESH ACCESS TOKEN: POST /protocol/openid-connect/token (grant_type=refresh_token)
  if (action === 'TOKEN_REFRESH') {
    const { refresh_token, username = 'judge3' } = body;
    if (!refresh_token || isRevoked(refresh_token)) {
      return NextResponse.json(
        { liveServer: false, error: { error: 'invalid_grant', error_description: 'Session not active (logged out)' } },
        { status: 400 }
      );
    }
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh_token || '',
    });

    try {
      const result = await callTideCloakOIDC('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (result.ok && result.data?.access_token) {
        return NextResponse.json({
          liveServer: true,
          endpoint: result.endpointUsed,
          tokenData: result.data,
        });
      }
    } catch {}

    const fb = buildFallbackTokenResponse(username);
    return NextResponse.json({
      liveServer: false,
      endpoint: `http://localhost:8080/auth/realms/${REALM}/protocol/openid-connect/token`,
      tokenData: fb.tokenResponse,
    });
  }

  // 3. VALIDATE / INTROSPECT TOKEN: POST /protocol/openid-connect/token/introspect
  if (action === 'TOKEN_INTROSPECT') {
    const { token, username = 'judge3' } = body;
    if (!token || isRevoked(token)) {
      return NextResponse.json({
        liveServer: false,
        endpoint: `http://localhost:8080/auth/realms/${REALM}/protocol/openid-connect/token/introspect`,
        introspection: { active: false },
      });
    }
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      token: token || '',
    });

    try {
      const result = await callTideCloakOIDC('/token/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (result.ok) {
        return NextResponse.json({
          liveServer: true,
          endpoint: result.endpointUsed,
          introspection: result.data,
        });
      }
    } catch {}

    const fb = buildFallbackTokenResponse(username);
    return NextResponse.json({
      liveServer: false,
      endpoint: `http://localhost:8080/auth/realms/${REALM}/protocol/openid-connect/token/introspect`,
      introspection: {
        active: Boolean(token),
        exp: fb.decodedPayload.exp,
        iat: fb.decodedPayload.iat,
        sub: fb.decodedPayload.sub,
        username: fb.decodedPayload.preferred_username,
        email: fb.decodedPayload.email,
        realm_access: fb.decodedPayload.realm_access,
      },
    });
  }

  // 4. RETRIEVE USER INFO: GET /protocol/openid-connect/userinfo
  if (action === 'USERINFO') {
    const { access_token, username = 'judge3' } = body;
    if (!access_token || isRevoked(access_token)) {
      return NextResponse.json(
        { liveServer: false, error: { error: 'invalid_token', error_description: 'Token revoked (logged out)' } },
        { status: 401 }
      );
    }
    try {
      const result = await callTideCloakOIDC('/userinfo', {
        method: 'GET',
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (result.ok) {
        return NextResponse.json({
          liveServer: true,
          endpoint: result.endpointUsed,
          userInfo: result.data,
        });
      }
    } catch {}

    const fb = buildFallbackTokenResponse(username);
    return NextResponse.json({
      liveServer: false,
      endpoint: `http://localhost:8080/auth/realms/${REALM}/protocol/openid-connect/userinfo`,
      userInfo: {
        sub: fb.decodedPayload.sub,
        email_verified: true,
        name: fb.decodedPayload.name,
        preferred_username: fb.decodedPayload.preferred_username,
        given_name: fb.decodedPayload.given_name,
        family_name: fb.decodedPayload.family_name,
        email: fb.decodedPayload.email,
      },
    });
  }

  // 5. LOGOUT: POST /protocol/openid-connect/logout
  if (action === 'LOGOUT') {
    const { refresh_token, access_token } = body;
    // Simulated revocation: always recorded locally, regardless of live/fallback mode
    if (refresh_token) revoked.add(refresh_token);
    if (access_token) revoked.add(access_token);
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh_token || '',
    });

    try {
      const result = await callTideCloakOIDC('/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (result.ok) {
        return NextResponse.json({
          liveServer: true,
          endpoint: result.endpointUsed,
          status: 204,
          message: '204 No Content - Session invalidated on TideCloak',
        });
      }
    } catch {}

    return NextResponse.json({
      liveServer: false,
      endpoint: `http://localhost:8080/auth/realms/${REALM}/protocol/openid-connect/logout`,
      status: 204,
      message: '204 No Content - Session invalidated',
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
