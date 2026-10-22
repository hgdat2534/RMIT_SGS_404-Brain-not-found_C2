"use client";
// Browser-side plumbing shared by every page.
//  - api():   calls to OUR server, through the SDK's secureFetch (DPoP), with absolute URLs.
//  - tc():    calls to TideCloak's admin API from the user's browser with the user's OWN token.
//             Approvals must go this way, never through our server (AP-89).
import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback } from "react";

export function useApi() {
  const { secureFetch, getToken, getConfig } = useTideCloak();

  const call = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const token = await getToken();
      const res = await secureFetch(url, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
      const text = await res.text();
      let body: any = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep text */
      }
      if (!res.ok) {
        const msg = body && typeof body === "object" && body.error ? body.error : `${res.status} ${res.statusText}`;
        const err = new Error(msg) as Error & { status?: number; body?: unknown };
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    },
    [secureFetch, getToken],
  );

  /** Our own API. secureFetch needs an ABSOLUTE url (relative ones throw "Invalid URL"). */
  const api = useCallback(
    (path: string, init?: RequestInit) => call(new URL(path, window.location.origin).href, init),
    [call],
  );

  /** TideCloak admin API for this realm, as the signed-in user. */
  const tcAdmin = useCallback(
    (path: string, init?: RequestInit) => {
      const cfg = getConfig() as { "auth-server-url": string; realm: string };
      const base = cfg["auth-server-url"].replace(/\/+$/, "");
      return call(`${base}/admin/realms/${cfg.realm}${path}`, init);
    },
    [call, getConfig],
  );

  return { api, tcAdmin };
}

/** Pull every message out of a Tide SDK error. A contract refusal arrives as
 * "Could not reach enough VVK ORKs" with the contract's own words in `cause` / detail lines. */
export function explainTideError(e: unknown): { headline: string; detail: string } {
  const seen = new Set<unknown>();
  const lines: string[] = [];
  let cur: any = e;
  while (cur && !seen.has(cur) && lines.length < 12) {
    seen.add(cur);
    if (typeof cur === "string") lines.push(cur);
    else if (cur.message) lines.push(String(cur.message));
    for (const k of ["details", "errors", "orkErrors"]) {
      if (Array.isArray(cur?.[k])) lines.push(...cur[k].map((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x))));
    }
    cur = cur?.cause;
  }
  const detail = Array.from(new Set(lines.join("\n").split("\n").map((s) => s.trim()).filter(Boolean))).join("\n");
  const known = [
    "role not found in doken",
    "not found in list of roles",
    "Tags do not contain assignmentId",
    "subjectId does not match",
    "group not found in doken",
    "THRESHOLD_FAILURE",
  ].find((k) => detail.includes(k));
  return { headline: known ? `Refused by the Tide network (${known})` : lines[0] || "Tide request failed", detail };
}

export const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const bytesToB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
