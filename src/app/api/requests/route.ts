import { withAuth } from "@/lib/auth/protect";
import { hasRole } from "@/lib/auth/tideJWT";
import { audit, mutate, readStore } from "@/lib/server/store";
import { ROLES, folderById, isoNow, newId, type AccessRequest } from "@/lib/errand/model";

const who = (jwt: Record<string, unknown>) => String(jwt.preferred_username ?? jwt.sub);

// The app-level request queue. A request here is a note, not a permission: nothing in TideCloak or
// the Tide network changes until Maya signs a change request in the enclave.
export const GET = withAuth(async (_req, jwt) => {
  const all = readStore().requests;
  if (hasRole(jwt, ROLES.owner)) return Response.json({ requests: all });
  if (hasRole(jwt, ROLES.agent)) return Response.json({ requests: all.filter((r) => r.from === "agent") });
  return Response.json({ error: "Forbidden" }, { status: 403 });
});

// Agent files a request for wider access.
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.agent)) return Response.json({ error: "Forbidden: agent only" }, { status: 403 });
  const b = await req.json();
  if (![ROLES.agentBills, ROLES.agentMedical].includes(b?.role)) return Response.json({ error: "unknown role" }, { status: 400 });
  const r: AccessRequest = {
    id: newId("req"), from: "agent", requestedBy: who(jwt), role: b.role,
    folder: folderById(String(b.folder))?.id, reason: String(b.reason ?? "").slice(0, 500),
    suspicious: !!b.suspicious, status: "pending", createdAt: isoNow(),
  };
  mutate((s) => { s.requests.unshift(r); });
  audit(who(jwt), "request", `Requested ${r.role}${r.suspicious ? " (flagged: reason quotes document text)" : ""}`, r.reason);
  return Response.json(r);
});

// Owner records the outcome after signing (or refusing) in the enclave.
export const PATCH = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  const b = await req.json();
  if (!["approved", "denied"].includes(b?.status)) return Response.json({ error: "status must be approved|denied" }, { status: 400 });
  const updated = mutate((s) => {
    const r = s.requests.find((x) => x.id === b.id);
    if (!r) return null;
    r.status = b.status; r.resolvedAt = isoNow();
    if (b.changeRequestId) r.changeRequestId = String(b.changeRequestId);
    return r;
  });
  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  audit(who(jwt), b.status === "approved" ? "grant" : "info", `Request ${updated.id} ${b.status}`, `${updated.role} — ${updated.reason}`);
  return Response.json(updated);
});
