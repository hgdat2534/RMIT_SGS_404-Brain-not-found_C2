import { withAuth } from "@/lib/auth/protect";
import { hasRole } from "@/lib/auth/tideJWT";
import { audit, mutate, readStore } from "@/lib/server/store";
import { POLICY_PLAN, ROLES, folderById, isoNow, type StoredPolicy } from "@/lib/errand/model";

// GET /api/policies            -> the policies whose Role subject is in the caller's VERIFIED token
// GET /api/policies?all=1      -> every policy (the "hijacked agent / compromised server" path).
// Handing a policy to the wrong caller grants nothing: the ORKs check the caller holds the policy's
// subject role. It does disclose who has access to what, which is why the default is filtered.
export const GET = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner) && !hasRole(jwt, ROLES.agent)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";
  const policies = readStore().policies.filter((p) => all || hasRole(jwt, p.role));
  return Response.json({ policies });
});

// POST /api/policies { key, policyB64 } — owner only. The bytes were signed by the Tide network after
// Maya approved in the enclave; we only store them.
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  const body = await req.json();
  const list: { key: string; policyB64: string }[] = Array.isArray(body?.policies) ? body.policies : [body];
  const saved: string[] = [];
  for (const p of list) {
    const plan = POLICY_PLAN.find((x) => x.key === p?.key);
    if (!plan || typeof p.policyB64 !== "string" || p.policyB64.length < 20) {
      return Response.json({ error: `unknown policy key or empty policy: ${p?.key}` }, { status: 400 });
    }
    const rec: StoredPolicy = {
      key: plan.key, role: plan.role, folder: plan.folder, recordId: folderById(plan.folder)!.recordId,
      access: plan.access, policyB64: p.policyB64, signedBy: String(jwt.preferred_username ?? jwt.sub), createdAt: isoNow(),
    };
    mutate((s) => { s.policies = s.policies.filter((x) => x.key !== rec.key); s.policies.push(rec); });
    saved.push(plan.key);
  }
  audit(String(jwt.preferred_username ?? jwt.sub), "grant", `Signed ${saved.length} folder policies in the Tide enclave`, saved.join(", "));
  return Response.json({ saved });
});
