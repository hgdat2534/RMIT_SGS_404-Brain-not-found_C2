import { withAuth } from "@/lib/auth/middleware";
import { isFolderId, isRequiredPolicy, type PolicyAccess } from "@/lib/domain/folders";
import { badRequest, callerOf, forbidden, readJson } from "@/lib/server/caller";
import { getStore } from "@/lib/server/store";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// GET /api/policies - every stored policy. Policies are public by design: they say who may open a
// record, and only work for a caller the network agrees is that subject.
export const GET = withAuth(async () => Response.json({ policies: getStore().listPolicies() }));

// POST /api/policies { folderId, recordId, subjectRole, access, policyB64 } - owner only.
// Only the six policies the vault design calls for can be stored (AP-RA08): a caller cannot
// overwrite a good policy with a policy for some other subject or record.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerOf(jwt);
  if (!caller.isOwner) return forbidden("Only the vault owner can store policies");

  const body = await readJson(req);
  if (!body) return badRequest("JSON body required");
  const { folderId, recordId, subjectRole, access, policyB64 } = body;
  if (!isFolderId(folderId) || !isRequiredPolicy({ folderId, recordId, subjectRole, access })) {
    return badRequest("Not one of the vault's policies (folder, record, subject role and access must match)");
  }
  if (typeof policyB64 !== "string" || policyB64.length < 16 || !BASE64.test(policyB64)) {
    return badRequest("policyB64 must be the signed policy bytes, base64-encoded");
  }

  const store = getStore();
  store.upsertPolicy({
    folderId,
    recordId: recordId as string,
    subjectRole: subjectRole as string,
    access: access as PolicyAccess,
    policyB64,
    grantedBy: caller.name,
    createdAt: new Date().toISOString(),
  });
  store.addAudit({
    actor: caller.name,
    action: "store signed policy",
    folderId,
    outcome: "info",
    detail: `RelationshipAttestation:1 policy: role ${subjectRole} may ${access} ${recordId}.`,
  });
  return Response.json({ ok: true }, { status: 201 });
});
