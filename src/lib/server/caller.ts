// Who is calling, read from the VERIFIED token (withAuth has already checked signature and DPoP).
import type { JWTPayload } from "jose";
import { hasRole } from "@/lib/auth/tideJWT";
import { AGENT_ROLE, OWNER_ROLE } from "@/lib/domain/folders";

export interface Caller {
  name: string;
  isOwner: boolean;
  isAgent: boolean;
}

export function callerOf(jwt: JWTPayload): Caller {
  const name = typeof jwt.preferred_username === "string" ? jwt.preferred_username : String(jwt.sub ?? "unknown");
  return { name, isOwner: hasRole(jwt, OWNER_ROLE), isAgent: hasRole(jwt, AGENT_ROLE) };
}

export function forbidden(message = "Forbidden"): Response {
  return Response.json({ error: message }, { status: 403 });
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
