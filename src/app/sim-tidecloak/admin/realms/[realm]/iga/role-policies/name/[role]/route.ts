// SIMULATED TideCloak: the realm's tide-realm-admin policy, which the owner attaches when she signs
// the folder policies (src/lib/tide/approvals.ts fetchAdminPolicy). Realm admins only.

import { withAuth } from "@/lib/auth/middleware";
import { pathSegments, simulatedOnly } from "@/lib/sim/http";
import { ADMIN_ROLE, getSimNetwork, rolesOf } from "@/lib/sim/network";
import { SIM_REALM } from "@/lib/sim/realm";

export const GET = simulatedOnly(
  withAuth(async (req, jwt) => {
    const [, , , realmName, , , , role] = pathSegments(req);
    if (realmName !== SIM_REALM || role !== ADMIN_ROLE) return Response.json({ error: "Policy not found" }, { status: 404 });
    if (!rolesOf(jwt).includes(ADMIN_ROLE)) return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ role: ADMIN_ROLE, policy: getSimNetwork().adminPolicy() });
  }),
);
