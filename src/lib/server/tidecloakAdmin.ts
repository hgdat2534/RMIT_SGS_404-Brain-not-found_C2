// Server-side TideCloak admin client - the PROPOSER.
//
// It authenticates as the TideCloak master admin (credentials from the server environment only).
// On an IGA realm in Tide multi-admin mode that credential can FILE a change request, and nothing
// more: a role grant or revoke comes back 202 with a pending change request, and approving it needs
// a tide-realm-admin's signature from the Tide enclave in their own browser. This file never calls
// approve/authorize/commit - by design, so a compromised server cannot widen the agent's access.

import { loadTideConfig } from "@/lib/auth/tidecloakConfig";
import { TIDE_SIMULATED } from "@/lib/mode";
import { SimTidecloakAdmin } from "@/lib/sim/adminClient";
import { getSimRealm } from "@/lib/sim/realm";

export interface AdminClientOptions {
  baseUrl: string;
  realm: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}

export interface FiledChange {
  /** The pending change request, or null when the realm applied the change directly (IGA off). */
  changeRequestId: string | null;
  applied: boolean;
}

export interface ChangeRequestInfo {
  id: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";
  actionType: string;
  entityId?: string;
  authorizationCount?: number;
  threshold?: number;
  readyToCommit?: boolean;
}

export class ChangeConflictError extends Error {
  constructor(message: string, readonly conflictingChangeRequestId?: string) {
    super(message);
    this.name = "ChangeConflictError";
  }
}

interface RoleRepresentation {
  id: string;
  name: string;
  [k: string]: unknown;
}

export class TidecloakAdmin {
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly opts: AdminClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private get adminBase(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}/admin/realms/${this.opts.realm}`;
  }

  /** Master-admin tokens live ~60 seconds: cache for 30 at most. */
  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const body = new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: this.opts.username,
      password: this.opts.password,
    });
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, "")}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`TideCloak admin login failed (HTTP ${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    const ttlMs = Math.min((json.expires_in ?? 60) * 1000, 30_000);
    this.token = { value: json.access_token, expiresAt: Date.now() + ttlMs - 5_000 };
    return json.access_token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return this.fetchImpl(`${this.adminBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.call(path);
    if (!res.ok) throw new Error(`TideCloak GET ${path} failed (HTTP ${res.status})`);
    return (await res.json()) as T;
  }

  async findUserId(username: string): Promise<string> {
    const users = await this.json<{ id: string; username: string }[]>(`/users?exact=true&username=${encodeURIComponent(username)}`);
    const user = users.find((u) => u.username === username);
    if (!user) throw new Error(`TideCloak user '${username}' not found`);
    return user.id;
  }

  async getUserRealmRoles(userId: string): Promise<string[]> {
    const roles = await this.json<RoleRepresentation[]>(`/users/${userId}/role-mappings/realm`);
    return roles.map((r) => r.name);
  }

  /**
   * Propose granting or revoking a realm role. On an IGA realm this files a change request and
   * returns its id; it does NOT approve it.
   */
  async proposeRealmRoleChange(userId: string, roleName: string, kind: "grant" | "revoke"): Promise<FiledChange> {
    const role = await this.json<RoleRepresentation>(`/roles/${encodeURIComponent(roleName)}`);
    const startedAt = Date.now();
    const res = await this.call(`/users/${userId}/role-mappings/realm`, {
      method: kind === "grant" ? "POST" : "DELETE",
      body: JSON.stringify([role]),
    });

    if (res.status === 409) {
      const detail = (await res.json().catch(() => ({}))) as { conflictingChangeRequestId?: string; error?: string; message?: string };
      throw new ChangeConflictError(
        "The agent account already has a pending change request. TideCloak allows one per user: " +
          "approve or deny that one first.",
        detail.conflictingChangeRequestId,
      );
    }
    if (res.status === 202) {
      const location = res.headers.get("location");
      const fromHeader = location ? location.split("/").filter(Boolean).pop() ?? null : null;
      const id = fromHeader ?? (await this.findNewestPendingFor(userId, startedAt));
      return { changeRequestId: id, applied: false };
    }
    if (res.ok) return { changeRequestId: null, applied: true };
    const text = await res.text().catch(() => "");
    throw new Error(`TideCloak refused to file the role change (HTTP ${res.status}) ${text.slice(0, 200)}`);
  }

  private async findNewestPendingFor(userId: string, since: number): Promise<string | null> {
    const pending = await this.listPendingChangeRequests();
    const mine = pending
      .filter((cr) => cr.entityId === userId && /ROLE/.test(cr.actionType))
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    const fresh = mine.find((cr) => Number(cr.createdAt ?? 0) >= since - 60_000) ?? mine[0];
    return fresh?.id ?? null;
  }

  async listPendingChangeRequests(): Promise<(ChangeRequestInfo & { createdAt?: number | string })[]> {
    const list = await this.json<unknown>(`/iga/change-requests?status=PENDING`);
    return Array.isArray(list) ? (list as (ChangeRequestInfo & { createdAt?: number })[]) : [];
  }

  async getChangeRequest(id: string): Promise<ChangeRequestInfo | null> {
    const res = await this.call(`/iga/change-requests/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TideCloak GET change request failed (HTTP ${res.status})`);
    return (await res.json()) as ChangeRequestInfo;
  }
}

/** What the server may do with its admin credential: look up, read, and file. Never approve. */
export type AdminApi = Pick<TidecloakAdmin, "findUserId" | "getUserRealmRoles" | "proposeRealmRoleChange" | "getChangeRequest" | "listPendingChangeRequests">;

let _admin: AdminApi | null = null;

/** The server's admin client. The internal URL lets the app container reach TideCloak by service name. */
export function getAdmin(): AdminApi {
  if (!_admin && TIDE_SIMULATED) _admin = new SimTidecloakAdmin(getSimRealm());
  if (!_admin) {
    const config = loadTideConfig();
    const password = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
    if (!password) throw new Error("KC_BOOTSTRAP_ADMIN_PASSWORD is not set in the server environment");
    _admin = new TidecloakAdmin({
      baseUrl: process.env.TIDECLOAK_INTERNAL_URL || config["auth-server-url"],
      realm: config.realm,
      username: process.env.KC_BOOTSTRAP_ADMIN_USERNAME || "admin",
      password,
    });
  }
  return _admin;
}

export const AGENT_USERNAME = process.env.ERRAND_AGENT_USERNAME || "errand-agent";
