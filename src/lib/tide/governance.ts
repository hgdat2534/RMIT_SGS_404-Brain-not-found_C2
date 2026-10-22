"use client";
// Two things only Maya's browser can do, both through ONE Tide enclave pop-up per batch:
//   1. sign the folder policies (RelationshipAttestation:1, Role subjects)
//   2. approve TideCloak change requests (role grants / revokes for the agent)
//
// Built on the same SDK calls as the pack's templates/relationship-attestation/relationship.ts and
// the two-phase /approve exchange in canon/iga-change-requests-api.md.
import { IAMService } from "@tidecloak/js";
import { Models } from "@tideorg/js";
import { PolicySignRequest } from "heimdall-tide";
import { buildRelationshipPolicy } from "./relationship";
import { b64ToBytes, bytesToB64 } from "./client";
import { POLICY_PLAN, folderById, type PolicyPlan } from "../errand/model";

interface TideClient {
  createTideRequest(encodedRequest: Uint8Array): Promise<Uint8Array>;
  requestTideOperatorApproval(
    requests: { id: string; request: Uint8Array }[],
  ): Promise<{ id: string; request: Uint8Array; status: "approved" | "denied" | "pending" }[]>;
  executeSignRequest(request: Uint8Array, waitForAll?: boolean): Promise<Uint8Array[]>;
}

function tc(): TideClient {
  const client = (IAMService as unknown as { _tc: TideClient | null })._tc;
  if (!client) throw new Error("TideCloak is not initialised");
  return client;
}

type TcAdmin = (path: string, init?: RequestInit) => Promise<any>;

/** The realm's admin policy (signed bytes). It authorises policy signing. Matched by exact name (AP-63). */
export async function fetchAdminPolicy(tcAdmin: TcAdmin): Promise<Uint8Array> {
  const r = await tcAdmin(`/iga/role-policies/name/tide-realm-admin`);
  const b64 = r?.policy;
  if (typeof b64 !== "string" || !b64) throw new Error("tide-realm-admin policy not found on the realm");
  return b64ToBytes(b64);
}

/** Sign every planned folder policy with one enclave approval. Returns base64 signed policies. */
export async function signFolderPolicies(
  vendorId: string,
  tcAdmin: TcAdmin,
  plans: PolicyPlan[] = POLICY_PLAN,
  onProgress?: (msg: string) => void,
): Promise<{ key: string; policyB64: string }[]> {
  if (!vendorId) throw new Error("vendorId missing from the adapter (data/tidecloak.json)");
  const adminPolicy = await fetchAdminPolicy(tcAdmin);

  const drafts = [];
  for (const plan of plans) {
    const folder = folderById(plan.folder)!;
    const policy = buildRelationshipPolicy({
      vendorId,
      subject: { type: "Role", id: plan.role },
      recordId: folder.recordId,
      access: plan.access,
    });
    const request = PolicySignRequest.New(policy);
    request.setCustomExpiry(604800);
    const initialised = await tc().createTideRequest(request.encode());
    const id = Models.BaseTideRequest.decode(initialised).getUniqueId();
    drafts.push({ plan, policy, id, initialised });
  }
  onProgress?.(`Approve ${drafts.length} policies in the Tide window`);

  const approvals = await tc().requestTideOperatorApproval(drafts.map((d) => ({ id: d.id, request: d.initialised })));

  const out: { key: string; policyB64: string }[] = [];
  for (const d of drafts) {
    const a = approvals.find((x) => x.id === d.id);
    if (!a || a.status !== "approved") throw new Error(`policy ${d.plan.key} was not approved (${a?.status ?? "no response"})`);
    const approved = Models.BaseTideRequest.decode(a.request);
    approved.addPolicy(adminPolicy);
    onProgress?.(`Network signing ${d.plan.key}…`);
    const sigs = await tc().executeSignRequest(approved.encode(), true);
    if (!sigs?.[0]) throw new Error(`no signature returned for ${d.plan.key}`);
    d.policy.signature = sigs[0];
    out.push({ key: d.plan.key, policyB64: bytesToB64(d.policy.toBytes()) });
  }
  return out;
}

export interface ApproveOutcome {
  id: string;
  ok: boolean;
  committed?: boolean;
  message: string;
}

/**
 * Approve TideCloak change requests from Maya's browser with her own token.
 * Phase 1: POST /approve {} → "recorded" (done) or "needs-approval" (+ requestModel).
 * Phase 2: one enclave pop-up for all requestModels, then POST /approve { requestModel } per id.
 */
export async function approveChangeRequests(ids: string[], tcAdmin: TcAdmin): Promise<ApproveOutcome[]> {
  const results: ApproveOutcome[] = [];
  const toSign: { id: string; request: Uint8Array }[] = [];

  for (const id of ids) {
    try {
      const r = await tcAdmin(`/iga/change-requests/${id}/approve`, { method: "POST", body: "{}" });
      if (r?.mode === "needs-approval" && r.requestModel) toSign.push({ id, request: b64ToBytes(r.requestModel) });
      else results.push({ id, ok: true, committed: !!r?.committed, message: `recorded (${r?.status ?? "?"})` });
    } catch (e) {
      results.push({ id, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (toSign.length) {
    const approvals = await tc().requestTideOperatorApproval(toSign);
    for (const s of toSign) {
      const a = approvals.find((x) => x.id === s.id);
      if (!a || a.status !== "approved") {
        results.push({ id: s.id, ok: false, message: `not signed in the enclave (${a?.status ?? "no response"})` });
        continue;
      }
      try {
        const r = await tcAdmin(`/iga/change-requests/${s.id}/approve`, {
          method: "POST",
          body: JSON.stringify({ requestModel: bytesToB64(a.request) }),
        });
        results.push({ id: s.id, ok: true, committed: !!r?.committed, message: r?.committed ? "signed and committed" : `signed (${r?.authCount ?? "?"}/${r?.threshold ?? "?"})` });
      } catch (e) {
        results.push({ id: s.id, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return results;
}

/** Deny a pending change request (Maya, from her browser). Only call on a request just read as PENDING. */
export async function denyChangeRequest(id: string, tcAdmin: TcAdmin, reason: string) {
  await tcAdmin(`/iga/change-requests/${id}/deny`, { method: "POST", body: JSON.stringify({ reason }) });
}
