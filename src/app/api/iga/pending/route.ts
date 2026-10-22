import { withAuth } from "@/lib/auth/protect";
import { hasRole } from "@/lib/auth/tideJWT";
import { AGENT_USERNAME, findUserId, listPending } from "@/lib/server/kcAdmin";
import { readStore } from "@/lib/server/store";
import { ROLES } from "@/lib/errand/model";

// Pending TideCloak change requests (a READ — approvals never go through this server).
export const GET = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  try {
    const [pending, agentId] = await Promise.all([listPending(), findUserId(AGENT_USERNAME).catch(() => "")]);
    const requests = readStore().requests;
    const changes = pending.map((cr) => {
      const linked = requests.find((r) => r.changeRequestId === cr.id);
      return {
        ...cr,
        involvesAgent: !!agentId && JSON.stringify(cr).includes(agentId),
        origin: linked?.from ?? "maya",
        flagged: linked ? linked.from === "operator" || linked.suspicious : false,
      };
    });
    return Response.json({ changes });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});
