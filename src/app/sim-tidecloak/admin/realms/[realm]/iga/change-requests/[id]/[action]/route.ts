// SIMULATED TideCloak IGA endpoints, called from the OWNER's browser with her own DPoP-bound token
// (src/lib/tide/approvals.ts, unchanged between modes):
//   POST .../change-requests/{id}/approve {}                  -> { mode: "needs-approval", requestModel }
//   POST .../change-requests/{id}/approve { requestModel }    -> commits, if the network signed it for her
//   POST .../change-requests/{id}/deny { reason }

import { withAuth } from "@/lib/auth/middleware";
import { readJson } from "@/lib/server/caller";
import { pathSegments, simErrorResponse, simulatedOnly } from "@/lib/sim/http";
import { getSimRealm, SIM_REALM } from "@/lib/sim/realm";

export const POST = simulatedOnly(
  withAuth(async (req, jwt) => {
    const [, , , realmName, , , id, action] = pathSegments(req);
    if (realmName !== SIM_REALM) return Response.json({ error: "Realm not found" }, { status: 404 });
    const realm = getSimRealm();
    const body = (await readJson(req)) ?? {};
    try {
      if (action === "approve") {
        if (typeof body.requestModel === "string") return Response.json(realm.commitApproval(jwt, id, body.requestModel));
        return Response.json(realm.startApproval(jwt, id));
      }
      if (action === "deny") return Response.json(realm.deny(jwt, id));
      return Response.json({ error: "Unknown action" }, { status: 404 });
    } catch (err) {
      return simErrorResponse(err);
    }
  }),
);
