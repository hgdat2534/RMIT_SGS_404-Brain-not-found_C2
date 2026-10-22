import { withAuth } from "@/lib/auth/protect";

// Echo of the VERIFIED token: what the server actually sees, not what the UI assumes.
export const GET = withAuth(async (_req, jwt) => {
  const realmRoles = ((jwt.realm_access as { roles?: string[] } | undefined)?.roles ?? []).slice().sort();
  return Response.json({
    sub: jwt.sub,
    username: jwt.preferred_username,
    realmRoles,
    tideuserkey: jwt.tideuserkey,
    exp: jwt.exp,
  });
});
