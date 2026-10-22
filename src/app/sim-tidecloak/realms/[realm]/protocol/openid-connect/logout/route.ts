// SIMULATED TideCloak logout: forget the refresh token so the session cannot be renewed.

import { simulatedOnly } from "@/lib/sim/http";
import { getSimRealm } from "@/lib/sim/realm";

export const POST = simulatedOnly(async (req: Request) => {
  const params = new URLSearchParams(await req.text());
  const token = params.get("refresh_token");
  if (token) getSimRealm().logout(token);
  return new Response(null, { status: 204 });
});
