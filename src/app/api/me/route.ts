import { withAuth } from "@/lib/auth/middleware";
import { callerOf } from "@/lib/server/caller";

// GET /api/me - who the server thinks you are, from your verified token.
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerOf(jwt);
  const realmRoles = ((jwt.realm_access as { roles?: string[] } | undefined)?.roles ?? []).filter((r) => !r.startsWith("default-roles"));
  return Response.json({ ...caller, realmRoles });
});
