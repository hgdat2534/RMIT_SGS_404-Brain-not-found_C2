// Which TideCloak the app talks to.
//
//   (unset)     the real thing: TideCloak in Docker, the Tide enclave and the ORK network.
//   simulated   in-process stand-ins for all three (src/lib/sim), so the app runs end to end
//               before a real realm exists. Same API routes, same token and DPoP checks, same
//               change-request flow; only the parties enforcing them are simulated.
//
// NEXT_PUBLIC_ so the browser bundle and the server agree. Read once at build/start.
export const TIDE_SIMULATED = process.env.NEXT_PUBLIC_TIDE_MODE === "simulated";
