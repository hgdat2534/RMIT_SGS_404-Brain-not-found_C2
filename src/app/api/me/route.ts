import { withAuth } from "@/lib/auth/middleware";
import { callerOf } from "@/lib/server/caller";

// GET /api/me - who the server thinks you are, from your verified token.
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerOf(jwt);
  const realmRoles = ((jwt.realm_access as { roles?: string[] } | undefined)?.roles ?? []).filter((r) => !r.startsWith("default-roles"));
  const resourceAccess = (jwt.resource_access as Record<string, { roles?: string[] }> | undefined) ?? {};
  const clientRoles = Object.values(resourceAccess).flatMap((c) => c.roles ?? []).filter((r) => !["manage-account", "view-profile", "manage-account-links"].includes(r));
  return Response.json({ ...caller, realmRoles, clientRoles, tokenExpiresAt: typeof jwt.exp === "number" ? jwt.exp * 1000 : null });
});
