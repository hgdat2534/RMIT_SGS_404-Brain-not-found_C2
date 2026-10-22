import { withAuth } from "@/lib/auth/protect";
import { hasRole } from "@/lib/auth/tideJWT";
import { audit, readStore } from "@/lib/server/store";
import { ROLES } from "@/lib/errand/model";

export const GET = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  return Response.json({ events: readStore().audit });
});

// Clients report what the Tide network told them (allowed / refused), so Maya sees it.
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner) && !hasRole(jwt, ROLES.agent)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json();
  const kind = ["info", "allowed", "refused"].includes(b?.kind) ? b.kind : "info";
  audit(String(jwt.preferred_username ?? jwt.sub), kind, String(b?.message ?? "").slice(0, 300), b?.detail ? String(b.detail).slice(0, 2000) : undefined);
  return Response.json({ ok: true });
});
