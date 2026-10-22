import { AGENT_USERNAME, fileRoleChange } from "@/lib/server/kcAdmin";
import { audit, mutate } from "@/lib/server/store";
import { ROLES, isoNow, newId, type AccessRequest } from "@/lib/errand/model";
import { operatorEnabled } from "../guard";

// The operator uses the master admin credential to "just give the agent Medical access".
// On this realm that produces a PENDING change request and nothing else.
export async function POST(req: Request) {
  if (!operatorEnabled()) return Response.json({ error: "operator console disabled" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const role = [ROLES.agentBills, ROLES.agentMedical].includes(b?.role) ? b.role : ROLES.agentMedical;
  try {
    const filed = await fileRoleChange(AGENT_USERNAME, role, "grant");
    const r: AccessRequest = {
      id: newId("req"), from: "operator", requestedBy: "server operator (master admin)", role,
      folder: role === ROLES.agentMedical ? "medical" : "bills", reason: "Admin override from the operator console",
      suspicious: true, status: "pending", changeRequestId: filed.changeRequestId, createdAt: isoNow(),
    };
    mutate((s) => { s.requests.unshift(r); });
    audit("operator", "operator", `Operator filed a grant of ${role} to ${AGENT_USERNAME} (HTTP ${filed.status})`,
      filed.changeRequestId ? `CR ${filed.changeRequestId} is PENDING. It needs Maya's enclave signature.` : JSON.stringify(filed.body).slice(0, 400));
    return Response.json({ filed, request: r });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
