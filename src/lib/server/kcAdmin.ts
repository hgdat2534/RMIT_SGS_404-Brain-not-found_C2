// Server-side calls to the TideCloak admin API, as the master admin (the "operator").
//
// This is the most powerful credential the app server has. The demo leans on what it CANNOT do:
// on an IGA realm in Tide MultiAdmin mode, a role grant made with it returns 202 and a PENDING change
// request. It cannot approve that request: approval needs Maya's signature in the Tide enclave, in
// her browser. Approvals are therefore never proxied through here (AP-89) — the browser sends them
// straight to TideCloak with Maya's own DPoP-bound token.
import { loadTideConfig } from "../auth/tidecloakConfig";

export const OWNER_USERNAME = process.env.ERRAND_OWNER_USERNAME || "maya";
export const AGENT_USERNAME = process.env.ERRAND_AGENT_USERNAME || "errand-agent";

function base() {
  const cfg = loadTideConfig();
  const url = (process.env.TIDECLOAK_URL || cfg["auth-server-url"]).replace(/\/+$/, "");
  return { url, realm: cfg.realm, admin: `${url}/admin/realms/${cfg.realm}` };
}

async function masterToken(): Promise<string> {
  const { url } = base();
  const user = process.env.KC_BOOTSTRAP_ADMIN_USERNAME || "admin";
  const pass = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
  if (!pass) throw new Error("KC_BOOTSTRAP_ADMIN_PASSWORD is not set in .env (server only)");
  const res = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: user, password: pass }),
    cache: "no-store",
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`master token failed: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}

async function call(path: string, init: RequestInit = {}) {
  const { admin } = base();
  const token = await masterToken();
  const res = await fetch(`${admin}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, location: res.headers.get("location"), body };
}

export async function findUserId(username: string): Promise<string> {
  const r = await call(`/users?username=${encodeURIComponent(username)}&exact=true`);
  const arr = r.body as { id: string }[];
  if (!Array.isArray(arr) || !arr[0]) throw new Error(`user '${username}' not found in realm`);
  return arr[0].id;
}

export async function userRealmRoles(username: string): Promise<string[]> {
  const id = await findUserId(username);
  const r = await call(`/users/${id}/role-mappings/realm`);
  return Array.isArray(r.body) ? (r.body as { name: string }[]).map((x) => x.name) : [];
}

export interface FiledChange {
  status: number;
  changeRequestId?: string;
  conflictingChangeRequestId?: string;
  body: unknown;
}

/** Grant or revoke a realm role. On an IGA realm this does NOT apply the change: it files it. */
export async function fileRoleChange(username: string, roleName: string, op: "grant" | "revoke"): Promise<FiledChange> {
  const id = await findUserId(username);
  const role = await call(`/roles/${encodeURIComponent(roleName)}`);
  if (role.status !== 200) throw new Error(`role '${roleName}' not found (${role.status})`);
  const r = await call(`/users/${id}/role-mappings/realm`, {
    method: op === "grant" ? "POST" : "DELETE",
    body: JSON.stringify([role.body]),
  });
  const fromLocation = r.location?.split("/").filter(Boolean).pop();
  const b = (r.body ?? {}) as Record<string, unknown>;
  return {
    status: r.status,
    changeRequestId: fromLocation || (b.id as string) || (b.changeRequestId as string) || undefined,
    conflictingChangeRequestId: b.conflictingChangeRequestId as string | undefined,
    body: r.body,
  };
}

export interface ChangeRequest {
  id: string;
  entityType: string;
  entityId: string;
  actionType: string;
  status: string;
  requestedBy?: string;
  createdAt?: number | string;
  rows?: unknown;
  authorizationCount?: number;
  threshold?: number;
  readyToCommit?: boolean;
}

export async function listPending(): Promise<ChangeRequest[]> {
  const r = await call(`/iga/change-requests?status=PENDING`);
  return Array.isArray(r.body) ? (r.body as ChangeRequest[]) : [];
}

/** What the operator gets when it tries to push its own change request through. */
export async function tryForceApprove(crId: string) {
  const authorize = await call(`/iga/change-requests/${crId}/authorize`, { method: "POST", body: "{}" });
  const approve = await call(`/iga/change-requests/${crId}/approve`, { method: "POST", body: "{}" });
  const commit = await call(`/iga/change-requests/${crId}/commit`, { method: "POST" });
  const strip = (x: { status: number; body: unknown }) => {
    const b = x.body as Record<string, unknown> | null;
    if (b && typeof b === "object" && "requestModel" in b) return { status: x.status, body: { ...b, requestModel: "<needs a Tide enclave signature — the server cannot produce one>" } };
    return { status: x.status, body: x.body };
  };
  return { authorize: strip(authorize), approve: strip(approve), commit: strip(commit) };
}

export async function realmInfo() {
  const { url, realm } = base();
  return { url, realm };
}
