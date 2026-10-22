import { withAuth } from "@/lib/auth/middleware";
import { agentFolderAccess } from "@/lib/server/accessRequests";
import { callerOf, forbidden } from "@/lib/server/caller";

// GET /api/agent-status - which folder roles the agent account holds in TideCloak right now.
// (What the agent can actually decrypt is decided by the network from its own token.)
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerOf(jwt);
  if (!caller.isOwner && !caller.isAgent && !caller.isAuditor) return forbidden("Only the owner, the auditor and the agent can see what the agent may open");
  try {
    return Response.json(await agentFolderAccess());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
});
