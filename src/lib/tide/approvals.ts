// Approving or denying an IGA change request - from the OWNER's browser, with her own DPoP-bound
// token, straight to TideCloak. Never proxied through the app server: approvals are credited to
// whoever authenticates the call, and the server must not hold a vote (AP-89, AP-37).
//
// Two-phase approve (Tide multi-admin mode):
//   1. POST /iga/change-requests/{id}/approve {}  -> mode "needs-approval" + requestModel (base64)
//   2. the owner signs requestModel in the Tide enclave pop-up
//   3. POST the same endpoint { requestModel: <signed, base64> } -> mode "recorded"; commits at quorum

import { fromBase64, toBase64 } from "./vaultPolicies";

export type SecureFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type ApproveTideRequests = (
  requests: { id: string; request: Uint8Array }[],
) => Promise<{ id: string; approved?: { request: Uint8Array }; denied?: boolean; pending?: boolean }[]>;

export interface IgaContext {
  /** TideCloak base URL as the browser sees it (adapter `auth-server-url`). */
  baseUrl: string;
  realm: string;
  secureFetch: SecureFetch;
  getToken: () => Promise<string | null>;
}

export interface ApproveResult {
  committed: boolean;
  status?: string;
  authCount?: number;
  threshold?: number;
}

function igaUrl(ctx: IgaContext, path: string): string {
  return `${ctx.baseUrl.replace(/\/+$/, "")}/admin/realms/${ctx.realm}/iga/change-requests/${path}`;
}

async function igaPost(ctx: IgaContext, path: string, body?: unknown): Promise<Response> {
  const token = await ctx.getToken();
  if (!token) throw new Error("Not signed in");
  // secureFetch upgrades `Bearer <its own token>` to `DPoP <token>` + a DPoP proof.
  return ctx.secureFetch(igaUrl(ctx, path), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readReply(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    const msg = (json.error ?? json.errorMessage ?? json.message ?? text) as string;
    throw new Error(`TideCloak answered HTTP ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return json;
}

export async function approveChangeRequest(ctx: IgaContext, changeRequestId: string, approveTideRequests: ApproveTideRequests): Promise<ApproveResult> {
  const first = await readReply(await igaPost(ctx, `${encodeURIComponent(changeRequestId)}/approve`, {}));

  if (first.mode !== "needs-approval") {
    return { committed: Boolean(first.committed), status: first.status as string, authCount: first.authCount as number, threshold: first.threshold as number };
  }

  const requestModel = first.requestModel;
  if (typeof requestModel !== "string") throw new Error("TideCloak asked for an enclave approval but sent no requestModel");

  const [result] = await approveTideRequests([{ id: changeRequestId, request: fromBase64(requestModel) }]);
  if (!result?.approved) {
    throw new Error(result?.denied ? "You declined the request in the Tide enclave." : "The Tide enclave did not return an approval.");
  }

  const second = await readReply(
    await igaPost(ctx, `${encodeURIComponent(changeRequestId)}/approve`, { requestModel: toBase64(result.approved.request) }),
  );
  return { committed: Boolean(second.committed), status: second.status as string, authCount: second.authCount as number, threshold: second.threshold as number };
}

export async function denyChangeRequest(ctx: IgaContext, changeRequestId: string, reason: string): Promise<void> {
  await readReply(await igaPost(ctx, `${encodeURIComponent(changeRequestId)}/deny`, { reason }));
}

/** The realm's tide-realm-admin policy, needed to authorise signing the folder policies. */
export async function fetchAdminPolicy(ctx: IgaContext): Promise<Uint8Array> {
  const token = await ctx.getToken();
  if (!token) throw new Error("Not signed in");
  const res = await ctx.secureFetch(`${ctx.baseUrl.replace(/\/+$/, "")}/admin/realms/${ctx.realm}/iga/role-policies/name/tide-realm-admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await readReply(res);
  if (typeof json.policy !== "string") throw new Error("The admin policy response has no `policy` field");
  return fromBase64(json.policy);
}
