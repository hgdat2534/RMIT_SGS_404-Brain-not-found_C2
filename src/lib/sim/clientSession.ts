// Browser side of a SIMULATED TideCloak session: the tab's DPoP key, its tokens, and the token
// endpoint calls. Browser only.
//
// The session lives in sessionStorage, so it is per TAB: Maya in one tab and the agent in another
// tab of the same browser work like the real demo's normal + private windows. (The real SDK keeps
// its DPoP key non-extractable; this one stores the private JWK in the tab so it survives a
// reload. That is a simulation shortcut, not something to copy.)

import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";
import { SIM_CLIENT_ID, SIM_LOGOUT_PATH, SIM_TOKEN_PATH } from "./constants";

const STORAGE_KEY = "errand.sim.session";
const DPOP_ALG = "ES256";

export interface StoredSession {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  dpop: { privateJwk: JWK; publicJwk: JWK };
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  error?: string;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the session lasts until the tab reloads.
  }
}

export function claimsOf(token: string | undefined): Record<string, unknown> {
  if (!token) return {};
  try {
    return decodeJwt(token) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function secondsLeft(token: string): number {
  const exp = claimsOf(token).exp;
  return typeof exp === "number" ? exp - Date.now() / 1000 : 0;
}

export async function newDpopKey(): Promise<StoredSession["dpop"]> {
  const { privateKey, publicKey } = await generateKeyPair(DPOP_ALG, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { privateJwk: await exportJWK(privateKey), publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y } };
}

export async function dpopThumbprint(dpop: StoredSession["dpop"]): Promise<string> {
  return calculateJwkThumbprint(dpop.publicJwk, "sha256");
}

async function sha256b64url(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An RFC 9449 proof, in the same shape the real SDK's secureFetch sends: htu is origin + path. */
export async function dpopProof(dpop: StoredSession["dpop"], method: string, url: string, accessToken?: string): Promise<string> {
  const u = new URL(url, window.location.origin);
  const payload: Record<string, unknown> = { htm: method.toUpperCase(), htu: `${u.origin}${u.pathname}`, jti: crypto.randomUUID() };
  if (accessToken) payload.ath = await sha256b64url(accessToken);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: DPOP_ALG, typ: "dpop+jwt", jwk: dpop.publicJwk })
    .setIssuedAt()
    .sign(await importJWK(dpop.privateJwk, DPOP_ALG));
}

async function tokenRequest(dpop: StoredSession["dpop"], params: Record<string, string>): Promise<StoredSession> {
  const url = new URL(SIM_TOKEN_PATH, window.location.origin).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", DPoP: await dpopProof(dpop, "POST", url) },
    body: new URLSearchParams(params),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!res.ok || !json.access_token || !json.id_token || !json.refresh_token) {
    throw new Error(`Simulated TideCloak refused the token request: ${json.error ?? `HTTP ${res.status}`}`);
  }
  return { accessToken: json.access_token, idToken: json.id_token, refreshToken: json.refresh_token, dpop };
}

export async function signIn(username: string): Promise<StoredSession> {
  const dpop = await newDpopKey();
  return tokenRequest(dpop, { grant_type: "password", client_id: SIM_CLIENT_ID, username });
}

export async function refreshSession(session: StoredSession): Promise<StoredSession> {
  return tokenRequest(session.dpop, { grant_type: "refresh_token", client_id: SIM_CLIENT_ID, refresh_token: session.refreshToken });
}

export async function endSession(session: StoredSession): Promise<void> {
  await fetch(SIM_LOGOUT_PATH, { method: "POST", body: new URLSearchParams({ refresh_token: session.refreshToken }) }).catch(() => undefined);
}
