// SIMULATED TideCloak token endpoint. Public client + DPoP, like the real realm:
//   grant_type=password      { username }        - sign-in (the simulated account picker)
//   grant_type=refresh_token { refresh_token }   - new tokens with the user's CURRENT roles
// Either way the caller proves possession of a key (DPoP header) and the tokens are bound to it.

import { pathSegments, simErrorResponse, simulatedOnly, verifyTokenRequestProof } from "@/lib/sim/http";
import { getSimRealm, SIM_REALM } from "@/lib/sim/realm";

async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

export const POST = simulatedOnly(async (req: Request) => {
  try {
    if (pathSegments(req)[2] !== SIM_REALM) return Response.json({ error: "Realm not found" }, { status: 404 });
    const jkt = await verifyTokenRequestProof(req);
    const params = await readParams(req);
    const realm = getSimRealm();
    switch (params.get("grant_type")) {
      case "password":
        return Response.json(await realm.signIn(params.get("username") ?? "", jkt));
      case "refresh_token":
        return Response.json(await realm.refresh(params.get("refresh_token") ?? "", jkt));
      default:
        return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    }
  } catch (err) {
    return simErrorResponse(err);
  }
});
