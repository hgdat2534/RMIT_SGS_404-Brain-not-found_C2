// Turning Tide SDK errors into something a person can read.
//
// A refusal by the RelationshipAttestation contract arrives as
// TIDE-TIDEJS-NET-THRESHOLD_FAILURE ("Could not reach enough VVK ORKs"). It is not an outage:
// every ORK answered, and they all said no. The contract's own message is in the error's cause.
// Never retry it (AP-RA18).

const CONTRACT_MESSAGES = [
  /role not found in doken/i,
  /not found in list of roles/i,
  /subjectId does not match/i,
  /group not found in doken/i,
  /Tags do not contain assignmentId/i,
  /must be tagged with the assignmentId/i,
  /role not found for this (de|en)cryption request/i,
];
const THRESHOLD = /THRESHOLD_FAILURE|Could not reach enough/i;

/** Flatten an error and its `cause` chain (and any per-ORK detail arrays) into one string. */
export function describeTideError(err: unknown, depth = 0): string {
  if (depth > 4 || err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error || typeof err === "object") {
    const e = err as { message?: unknown; cause?: unknown; errors?: unknown; details?: unknown };
    const parts: string[] = [];
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    for (const nested of [e.errors, e.details]) {
      if (Array.isArray(nested)) parts.push(...nested.map((n) => describeTideError(n, depth + 1)).filter(Boolean));
    }
    const cause = describeTideError(e.cause, depth + 1);
    if (cause && !parts.includes(cause)) parts.push(cause);
    if (!parts.length) {
      try {
        return JSON.stringify(err).slice(0, 500);
      } catch {
        return String(err);
      }
    }
    return [...new Set(parts)].join(" <- ");
  }
  return String(err);
}

/** True when the network refused the operation on policy grounds (as opposed to a real failure). */
export function isNetworkRefusal(err: unknown): boolean {
  const text = describeTideError(err);
  return THRESHOLD.test(text) || CONTRACT_MESSAGES.some((re) => re.test(text));
}

/** The contract's own message, if one is in the error. */
export function contractReason(err: unknown): string | null {
  const parts = describeTideError(err).split(" <- ");
  for (const re of CONTRACT_MESSAGES) {
    const part = parts.find((p) => re.test(p));
    if (part) return part.trim();
  }
  return null;
}
