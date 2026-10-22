// SIMULATED Tide network, as the browser reaches it. Every call carries the caller's own DPoP-bound
// token, and the network reads the caller's roles from THAT token - never from the app server.
//   POST /sim-tide/encrypt        { items: {data, tags}[], policy }      -> { ciphertexts }
//   POST /sim-tide/decrypt        { items: {encrypted, tags}[], policy } -> { plaintexts }
//   POST /sim-tide/sign-policies  { specs, vendorId, adminPolicy }       -> { policies }   (enclave-approved)
//   POST /sim-tide/approve        { requestModel }                       -> { approved }   (enclave-approved)

import { withAuth } from "@/lib/auth/middleware";
import type { PolicySpec } from "@/lib/domain/folders";
import { readJson } from "@/lib/server/caller";
import { pathSegments, simErrorResponse, simulatedOnly } from "@/lib/sim/http";
import { getSimNetwork } from "@/lib/sim/network";

const MAX_ITEMS = 50;

const isTags = (v: unknown): v is string[] => Array.isArray(v) && v.every((t) => typeof t === "string");

export const POST = simulatedOnly(
  withAuth(async (req, jwt) => {
    const op = pathSegments(req)[1];
    const body = await readJson(req);
    if (!body) return Response.json({ error: "JSON body required" }, { status: 400 });
    const network = getSimNetwork();

    try {
      switch (op) {
        case "encrypt": {
          const items = body.items;
          if (typeof body.policy !== "string" || !Array.isArray(items) || items.length > MAX_ITEMS) break;
          if (!items.every((i) => i && typeof i.data === "string" && isTags(i.tags))) break;
          return Response.json({ ciphertexts: network.encrypt(jwt, items, body.policy) });
        }
        case "decrypt": {
          const items = body.items;
          if (typeof body.policy !== "string" || !Array.isArray(items) || items.length > MAX_ITEMS) break;
          if (!items.every((i) => i && typeof i.encrypted === "string" && isTags(i.tags))) break;
          return Response.json({ plaintexts: network.decrypt(jwt, items, body.policy) });
        }
        case "sign-policies": {
          if (!Array.isArray(body.specs) || typeof body.vendorId !== "string" || typeof body.adminPolicy !== "string") break;
          return Response.json({ policies: network.signPolicies(jwt, body.specs as PolicySpec[], body.vendorId, body.adminPolicy) });
        }
        case "approve": {
          if (typeof body.requestModel !== "string") break;
          return Response.json({ approved: network.approveChange(jwt, body.requestModel) });
        }
        default:
          return Response.json({ error: "Unknown operation" }, { status: 404 });
      }
    } catch (err) {
      return simErrorResponse(err);
    }
    return Response.json({ error: `Malformed ${op} request` }, { status: 400 });
  }),
);
