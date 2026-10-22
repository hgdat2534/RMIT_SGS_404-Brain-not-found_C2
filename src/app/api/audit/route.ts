import { withAuth } from "@/lib/auth/middleware";
import { isFolderId } from "@/lib/domain/folders";
import { badRequest, callerOf, forbidden, readJson } from "@/lib/server/caller";
import { getStore, type AuditEntry } from "@/lib/server/store";

const OUTCOMES: AuditEntry["outcome"][] = ["allowed", "refused", "queued", "info"];

// GET /api/audit - everything that happened, newest first. The owner and her auditor only.
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerOf(jwt);
  if (!caller.isOwner && !caller.isAuditor) return forbidden("Only the vault owner and the auditor can read the activity log");
  return Response.json({ audit: [...getStore().listAudit()].reverse() });
});

// POST /api/audit { action, folderId?, outcome, detail } - every page reports the result of each
// Tide call here, so the owner can see refused decrypts - including Sam's, Kim's or Alex's. It is a
// log of what the browser reported, not evidence: the Tide network, not this log, enforced the
// result. Never send plaintext here.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerOf(jwt);
  if (!caller.isKnown) return forbidden();
  const body = await readJson(req);
  if (!body || typeof body.action !== "string" || typeof body.detail !== "string") return badRequest("action and detail are required");
  if (!OUTCOMES.includes(body.outcome as AuditEntry["outcome"])) return badRequest("bad outcome");
  if (body.folderId !== undefined && !isFolderId(body.folderId)) return badRequest("bad folderId");

  const entry = getStore().addAudit({
    actor: caller.name,
    action: body.action.slice(0, 120),
    folderId: body.folderId as AuditEntry["folderId"],
    outcome: body.outcome as AuditEntry["outcome"],
    detail: body.detail.slice(0, 1000),
  });
  return Response.json({ entry }, { status: 201 });
});
