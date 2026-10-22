import { withAuth } from "@/lib/auth/protect";
import { hasRole } from "@/lib/auth/tideJWT";
import { audit } from "@/lib/server/store";
import { AGENT_USERNAME, fileRoleChange, userRealmRoles } from "@/lib/server/kcAdmin";
import { ROLES } from "@/lib/errand/model";

const GRANTABLE: string[] = [ROLES.agentBills, ROLES.agentMedical];

// GET: which agent.* roles are COMMITTED on the agent's account right now (owner only).
export const GET = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  try {
    const roles = await userRealmRoles(AGENT_USERNAME);
    return Response.json({ agent: AGENT_USERNAME, roles });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});

// POST { op: "grant"|"revoke", role } — the server FILES the change. It cannot approve it.
// Maya's browser then approves it directly with TideCloak in the Tide enclave.
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  const b = await req.json();
  if (!GRANTABLE.includes(b?.role) || !["grant", "revoke"].includes(b?.op)) {
    return Response.json({ error: "role must be an agent.* role and op grant|revoke" }, { status: 400 });
  }
  try {
    const filed = await fileRoleChange(AGENT_USERNAME, b.role, b.op);
    audit(String(jwt.preferred_username ?? jwt.sub), b.op === "grant" ? "grant" : "revoke",
      `Filed change request: ${b.op} ${b.role} for ${AGENT_USERNAME} (HTTP ${filed.status})`,
      filed.changeRequestId ? `CR ${filed.changeRequestId} — waiting for an enclave signature` : JSON.stringify(filed.body).slice(0, 400));
    return Response.json(filed, { status: filed.status >= 400 ? filed.status : 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});
