// Shared plumbing for the simulated TideCloak and network routes.

import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { MemoryJtiStore, requestHtu } from "@/lib/auth/verifyDpop";
import { TIDE_SIMULATED } from "@/lib/mode";
import { NetworkRefusal } from "./network";
import { SimHttpError } from "./realm";

/** Every simulated route answers 404 unless the app was started in simulated mode. */
export function simulatedOnly<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    if (!TIDE_SIMULATED) return Response.json({ error: "Not found" }, { status: 404 });
    return handler(...args);
  };
}

/** Map a refusal to the status the real party would answer with. */
export function simErrorResponse(err: unknown): Response {
  if (err instanceof NetworkRefusal) {
    return Response.json({ code: err.code, error: NetworkRefusal.SUMMARY, reason: err.reason }, { status: 403 });
  }
  if (err instanceof SimHttpError) {
    return Response.json({ error: err.message, ...err.extra }, { status: err.status });
  }
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

const tokenEndpointJtis = new MemoryJtiStore();

/**
 * Proof of possession at the token endpoint (RFC 9449 §4): there is no access token yet, so the
 * proof has no `ath`, and its key's thumbprint becomes the new token's cnf.jkt.
 */
export async function verifyTokenRequestProof(req: Request): Promise<string> {
  const proof = req.headers.get("dpop");
  if (!proof) throw new SimHttpError(400, "invalid_dpop_proof: missing DPoP header");
  let jwk: JWK | undefined;
  let alg: string | undefined;
  try {
    const header = decodeProtectedHeader(proof);
    if (header.typ !== "dpop+jwt") throw new Error(`typ is '${header.typ}'`);
    jwk = header.jwk as JWK | undefined;
    alg = header.alg;
  } catch (e) {
    throw new SimHttpError(400, `invalid_dpop_proof: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!jwk || !alg) throw new SimHttpError(400, "invalid_dpop_proof: no embedded jwk");

  let payload: Record<string, unknown>;
  try {
    ({ payload } = (await jwtVerify(proof, await importJWK(jwk, alg))) as { payload: Record<string, unknown> });
  } catch (e) {
    throw new SimHttpError(400, `invalid_dpop_proof: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (payload.htm !== "POST") throw new SimHttpError(400, "invalid_dpop_proof: htm must be POST");
  if (payload.htu !== requestHtu(req)) throw new SimHttpError(400, `invalid_dpop_proof: htu '${String(payload.htu)}' does not match`);
  if (typeof payload.iat !== "number" || Math.abs(Date.now() / 1000 - payload.iat) > 300) throw new SimHttpError(400, "invalid_dpop_proof: stale iat");
  if (typeof payload.jti !== "string" || !(await tokenEndpointJtis.claim(payload.jti, Date.now() + 300_000))) {
    throw new SimHttpError(400, "invalid_dpop_proof: missing or replayed jti");
  }
  return calculateJwkThumbprint(jwk, "sha256");
}

/** The last path segments of a request, for routes with ids in the path. */
export function pathSegments(req: Request): string[] {
  return new URL(req.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
}
