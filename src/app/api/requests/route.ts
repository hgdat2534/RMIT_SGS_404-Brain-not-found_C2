import { withAuth } from "@/lib/auth/middleware";
import { isFolderId, type FolderId } from "@/lib/domain/folders";
import type { RequestTrigger } from "@/lib/domain/risk";
import { fileAccessChange, syncRequests } from "@/lib/server/accessRequests";
import { badRequest, callerOf, forbidden, readJson } from "@/lib/server/caller";

const AGENT_TASK_SCOPE: FolderId[] = ["bills"];

// GET /api/requests - owner sees every request; the agent sees its own.
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerOf(jwt);
  if (!caller.isOwner && !caller.isAgent) return forbidden();
  const requests = await syncRequests();
  const visible = caller.isOwner ? requests : requests.filter((r) => r.requestedBy === "agent");
  return Response.json({ requests: [...visible].reverse() });
});

// POST /api/requests
//   owner: { kind: "grant" | "revoke", folderId }
//   agent: { folderId, reason, trigger? }  (the agent can only ask for MORE; it cannot revoke or approve)
// Either way the result is a pending TideCloak change request that only the owner can sign.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerOf(jwt);
  const body = await readJson(req);
  if (!body || !isFolderId(body.folderId)) return badRequest("folderId must be bills, medical or id");
  const folderId = body.folderId;

  try {
    if (caller.isOwner) {
      if (body.kind !== "grant" && body.kind !== "revoke") return badRequest("kind must be grant or revoke");
      const request = await fileAccessChange({
        kind: body.kind,
        folderId,
        requestedBy: "owner",
        requesterName: caller.name,
        reason: body.kind === "grant" ? `${caller.name} grants Errand read access.` : `${caller.name} revokes Errand's access.`,
      });
      return Response.json({ request }, { status: 201 });
    }

    if (caller.isAgent) {
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "";
      if (!reason) return badRequest("reason is required");
      const t = body.trigger as Partial<RequestTrigger> | undefined;
      const trigger =
        t && typeof t.docId === "string" && typeof t.excerpt === "string"
          ? { docId: t.docId.slice(0, 100), excerpt: t.excerpt.slice(0, 300) }
          : undefined;
      const request = await fileAccessChange({
        kind: "grant",
        folderId,
        requestedBy: "agent",
        requesterName: caller.name,
        reason,
        trigger,
        taskScope: AGENT_TASK_SCOPE,
      });
      return Response.json({ request }, { status: 201 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }

  return forbidden();
});
