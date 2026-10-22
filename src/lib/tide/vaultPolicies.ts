// Signing the vault's folder policies in ONE enclave approval. Browser only.
//
// Same five steps as signRelationshipPolicy in relationship.ts (initialise, operator approval,
// attach the admin policy, execute, attach the signature), but the approvals are batched so Maya
// approves all six folder policies in a single Tide pop-up.

import { IAMService } from "@tidecloak/js";
import { Models } from "@tideorg/js";
import { PolicySignRequest } from "heimdall-tide";
import { buildRelationshipPolicy } from "./relationship";
import type { PolicySpec } from "@/lib/domain/folders";

const SIGN_REQUEST_EXPIRY_SECONDS = 604800;

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

export const toBase64 = (b: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
};
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface SignedPolicy extends PolicySpec {
  policyB64: string;
}

/**
 * Sign every spec with a Role subject. `adminPolicy` is the realm's tide-realm-admin policy bytes
 * (GET {auth-server-url}/admin/realms/{realm}/iga/role-policies/name/tide-realm-admin, field `policy`).
 * Must be called straight from a click, or the browser blocks the enclave pop-up.
 */
export async function signVaultPolicies(specs: PolicySpec[], vendorId: string, adminPolicy: Uint8Array): Promise<SignedPolicy[]> {
  const prepared = await Promise.all(
    specs.map(async (spec, index) => {
      const policy = buildRelationshipPolicy({
        vendorId,
        subject: { type: "Role", id: spec.subjectRole },
        recordId: spec.recordId,
        access: spec.access,
      });
      const request = PolicySignRequest.New(policy);
      request.setCustomExpiry(SIGN_REQUEST_EXPIRY_SECONDS);
      const initialised = await tc().createTideRequest(request.encode());
      const id = Models.BaseTideRequest.decode(initialised).getUniqueId() || `policy-${index}`;
      return { spec, policy, id, initialised };
    }),
  );

  const approvals = await tc().requestTideOperatorApproval(prepared.map((p) => ({ id: p.id, request: p.initialised })));

  const signed: SignedPolicy[] = [];
  for (const p of prepared) {
    const approval = approvals.find((a) => a.id === p.id);
    if (!approval || approval.status !== "approved") {
      throw new Error(`Policy for ${p.spec.subjectRole} on ${p.spec.folderId} was not approved (${approval?.status ?? "no response"})`);
    }
    const approved = Models.BaseTideRequest.decode(approval.request);
    approved.addPolicy(adminPolicy);
    const signatures = await tc().executeSignRequest(approved.encode(), true);
    if (!signatures?.[0]) throw new Error("The network returned no signature");
    p.policy.signature = signatures[0];
    signed.push({ ...p.spec, policyB64: toBase64(p.policy.toBytes()) });
  }
  return signed;
}
