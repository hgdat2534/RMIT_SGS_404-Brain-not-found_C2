/**
 * tideSim.ts — server-side SIMULATION of TideCloak access checks.
 *
 * In production TideCloak, every API route verifies a threshold-signed (EdDSA) access
 * token + DPoP proof, then checks realm roles. Here we:
 *   - read the Bearer token sent by the browser,
 *   - decode its claims (signature NOT verified — simulation only),
 *   - reject revoked (logged-out) or expired tokens,
 *   - enforce the role / ownership / quorum policy below.
 *
 * Swap-out point: replace decodeClaims() with real TideCloak token + DPoP verification
 * (e.g. @tidecloak/nextjs server helpers). The POLICY table stays the same.
 */

export type TideClaims = {
  sub: string;
  preferred_username: string;
  name?: string;
  exp?: number;
  realm_access?: { roles?: string[] };
};

export type AccessDecision = {
  allowed: boolean;
  status: 200 | 401 | 403;
  code: string;
  reason: string;
  action: string;
  subject?: string;
  roles?: string[];
};

/** Where TideCloak decides — one row per protected action. */
export const POLICY = {
  CREATE_SUBMISSION: {
    roles: [] as string[],
    note: 'Candidate seals identity in-browser (_tide_message.selfencrypt). No judge token needed.',
  },
  LOCK_JUDGE_SCORE: {
    roles: ['committee_judge'],
    note: 'Only a signed-in judge, and only for their own slot.',
  },
  UNMASK_IDENTITY: {
    roles: ['committee_judge', '_tide_message.selfdecrypt'],
    note: 'Judge with decrypt role AND 3-of-3 locked scores. Target: TideCloak multi-approval policy.',
  },
  ADMIN_RAW_DUMP: {
    roles: ['platform_admin'],
    note: 'Even an admin only ever receives ciphertext — no key exists on this server.',
  },
} as const;

export type ProtectedAction = keyof typeof POLICY;

const revoked: Set<string> = ((globalThis as any).__bvRevokedTokens ??= new Set<string>());

export function readBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** SIMULATION: decodes JWT payload without verifying the signature. */
export function decodeClaims(token: string): TideClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    const c = JSON.parse(json);
    return c?.sub || c?.preferred_username ? c : null;
  } catch {
    return null;
  }
}

/** judge3 -> judge-3 (maps TideCloak username to the grading slot it owns). */
export function slotForUsername(username?: string): string | null {
  const m = username?.match(/^judge(\d+)$/);
  return m ? `judge-${m[1]}` : null;
}

function deny(action: string, status: 401 | 403, code: string, reason: string, c?: TideClaims): AccessDecision {
  return {
    allowed: false,
    status,
    code,
    reason,
    action,
    subject: c?.preferred_username,
    roles: c?.realm_access?.roles,
  };
}

export function checkAccess(
  action: ProtectedAction,
  authHeader: string | null,
  ctx: { judgeSlot?: string; lockedCount?: number; totalJudges?: number } = {}
): AccessDecision {
  const rule = POLICY[action];
  if (rule.roles.length === 0) {
    return { allowed: true, status: 200, code: 'PUBLIC', reason: rule.note, action };
  }

  const token = readBearer(authHeader);
  if (!token) return deny(action, 401, 'NO_TOKEN', 'No TideCloak access token presented');
  if (revoked.has(token)) return deny(action, 401, 'TOKEN_REVOKED', 'Session was logged out');

  const claims = decodeClaims(token);
  if (!claims) return deny(action, 401, 'TOKEN_INVALID', 'Token could not be parsed');
  if (claims.exp && claims.exp * 1000 < Date.now()) {
    return deny(action, 401, 'TOKEN_EXPIRED', 'Access token expired — refresh required', claims);
  }

  const roles = claims.realm_access?.roles || [];
  const missing = rule.roles.filter((r) => !roles.includes(r));
  if (missing.length) {
    return deny(action, 403, 'MISSING_ROLE', `Token lacks role(s): ${missing.join(', ')}`, claims);
  }

  if (action === 'LOCK_JUDGE_SCORE') {
    const own = slotForUsername(claims.preferred_username);
    if (!own || own !== ctx.judgeSlot) {
      return deny(
        action,
        403,
        'NOT_SLOT_OWNER',
        `${claims.preferred_username} may only lock their own slot (${own ?? 'none'}), not ${ctx.judgeSlot}`,
        claims
      );
    }
  }

  if (action === 'UNMASK_IDENTITY') {
    const total = ctx.totalJudges ?? 3;
    if ((ctx.lockedCount ?? 0) < total) {
      return deny(
        action,
        403,
        'QUORUM_NOT_MET',
        `Emergent authority needs ${total}/${total} locked scores; currently ${ctx.lockedCount ?? 0}/${total}`,
        claims
      );
    }
  }

  return {
    allowed: true,
    status: 200,
    code: 'ALLOWED',
    reason: rule.note,
    action,
    subject: claims.preferred_username,
    roles,
  };
}
