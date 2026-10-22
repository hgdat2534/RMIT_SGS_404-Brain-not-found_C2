"use client";

// The SIMULATED Tide runtime: a TideCloak session, a Tide enclave and the network, all stand-ins.
// Imported as `@tide-runtime` when NEXT_PUBLIC_TIDE_MODE=simulated (see next.config.ts); the real
// one is src/lib/tide/runtime.tsx. Pages cannot tell them apart except by TIDE_MODE.
//
// The enclave here is a dialog in the app's own page. In the real system it is Tide's page on the
// ORK origin, which the app cannot script; here nothing stops the page from clicking "Approve"
// itself. The network still refuses anyone without the role, so the checks are real; the human
// step is illustrated.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TideMode, TideOps, TideRuntime, TideRuntimeModule, TideSession } from "@/lib/client/tideRuntime";
import { fromBase64, toBase64 } from "@/lib/encoding";
import { claimsOf, dpopProof, endSession, loadSession, refreshSession, saveSession, secondsLeft, type StoredSession } from "./clientSession";
import { SIM_CLIENT_ID, SIM_LOGIN_PAGE, SIM_REALM, SIM_TIDECLOAK_PATH, SIM_VENDOR_ID } from "./constants";

export const TIDE_MODE: TideMode = "simulated";

const REFRESH_MARGIN_S = 20;

interface EnclaveRequest {
  title: string;
  lines: string[];
  resolve: (approved: boolean) => void;
}

interface SimContext {
  session: StoredSession | null;
  initializing: boolean;
  /** Fresh access token, refreshing first if it is about to expire. */
  currentToken: () => Promise<string | null>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  askEnclave: (title: string, lines: string[]) => Promise<boolean>;
}

const Ctx = createContext<SimContext | null>(null);

export function TideProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [enclave, setEnclave] = useState<EnclaveRequest | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);

  const adopt = useCallback((next: StoredSession | null) => {
    sessionRef.current = next;
    saveSession(next);
    setSession(next);
  }, []);

  // One refresh at a time: refresh tokens rotate, so a second concurrent refresh would be refused.
  const refresh = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return Promise.resolve();
    refreshing.current ??= refreshSession(current)
      .then(adopt)
      .catch((err) => {
        adopt(null);
        throw err;
      })
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [adopt]);

  const currentToken = useCallback(async () => {
    if (sessionRef.current && secondsLeft(sessionRef.current.accessToken) < REFRESH_MARGIN_S) await refresh();
    return sessionRef.current?.accessToken ?? null;
  }, [refresh]);

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    adopt(null);
    if (current) await endSession(current);
  }, [adopt]);

  const askEnclave = useCallback(
    (title: string, lines: string[]) => new Promise<boolean>((resolve) => setEnclave({ title, lines, resolve })),
    [],
  );

  useEffect(() => {
    const stored = loadSession();
    sessionRef.current = stored;
    setSession(stored);
    const ready = stored && secondsLeft(stored.accessToken) < REFRESH_MARGIN_S ? refresh().catch(() => undefined) : Promise.resolve();
    ready.finally(() => setInitializing(false));
  }, [refresh]);

  const value = useMemo(() => ({ session, initializing, currentToken, refresh, signOut, askEnclave }), [session, initializing, currentToken, refresh, signOut, askEnclave]);

  const answer = (approved: boolean) => {
    enclave?.resolve(approved);
    setEnclave(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {enclave && (
        <div className="sim-enclave-backdrop" role="dialog" aria-modal="true" aria-labelledby="sim-enclave-title">
          <div className="sim-enclave">
            <div className="sim-enclave-brand">Tide window · simulated</div>
            <h2 id="sim-enclave-title">{enclave.title}</h2>
            <p className="muted small">
              Signed in as <b>{String(claimsOf(session?.idToken).preferred_username ?? "?")}</b>. In real Tide this is a separate, secure
              window that the Errand app cannot control. Approving signs with your own session, and the Tide network checks that you are
              allowed to.
            </p>
            <ul>{enclave.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <button className="btn-primary" onClick={() => answer(true)}>Approve</button>
            <button onClick={() => answer(false)}>Deny</button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

function useSim(): SimContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTide must be used inside TideProvider");
  return ctx;
}

/** The network's refusal, shaped like the SDK's: code + message, the contract's reason as cause. */
function networkError(json: { code?: string; error?: string; reason?: string }, status: number): Error {
  if (json.code) return new Error(`${json.code}: ${json.error ?? "refused"}`, { cause: json.reason ? new Error(json.reason) : undefined });
  return new Error(json.error ?? `HTTP ${status}`);
}

function describeChange(request: Uint8Array): string {
  try {
    const m = JSON.parse(new TextDecoder().decode(request)) as { kind?: string; role?: string; username?: string; changeRequestId?: string };
    return `${m.kind === "revoke" ? "Revoke" : "Grant"} role ${m.role} ${m.kind === "revoke" ? "from" : "to"} ${m.username} (change request ${m.changeRequestId?.slice(0, 8)})`;
  } catch {
    return "Unreadable change request";
  }
}

export function useTide(): TideRuntime {
  const sim = useSim();
  const { session: stored, initializing, currentToken, refresh, signOut, askEnclave } = sim;

  const secureFetch = useCallback<TideSession["secureFetch"]>(
    async (input, init = {}) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init.method ?? (input instanceof Request ? input.method : "GET");
      const headers = new Headers(init.headers);
      const auth = headers.get("Authorization");
      const current = sim.session;
      // Like the SDK: our own Bearer token is upgraded to the DPoP scheme plus a proof for this request.
      if (current && auth?.startsWith("Bearer ")) {
        const token = auth.slice(7);
        headers.set("Authorization", `DPoP ${token}`);
        headers.set("DPoP", await dpopProof(current.dpop, method, href, token));
      }
      return fetch(href, { ...init, method, headers });
    },
    [sim.session],
  );

  /** POST to the simulated network with this tab's DPoP-bound token. */
  const networkCall = useCallback(
    async <T,>(path: string, body: unknown): Promise<T> => {
      const token = await currentToken();
      if (!token) throw new Error("Not signed in");
      const res = await secureFetch(new URL(path, window.location.origin).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as T & { code?: string; error?: string; reason?: string };
      if (!res.ok) throw networkError(json, res.status);
      return json;
    },
    [currentToken, secureFetch],
  );

  const session: TideSession = useMemo(() => {
    const access = claimsOf(stored?.accessToken);
    const id = claimsOf(stored?.idToken);
    const realmRoles = ((access.realm_access as { roles?: string[] } | undefined)?.roles ?? []) as string[];
    return {
      authenticated: Boolean(stored),
      isInitializing: initializing,
      login: async () => {
        window.location.assign(`${SIM_LOGIN_PAGE}?return=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      },
      logout: async () => {
        await signOut();
        window.location.assign("/");
      },
      hasRealmRole: (role: string) => realmRoles.includes(role),
      getValueFromIdToken: (key: string) => id[key],
      getToken: currentToken,
      forceRefreshToken: async () => {
        await refresh();
        return true;
      },
      secureFetch,
      // Pages read this while rendering, including on the server; the URL is only used from the browser.
      getConfig: () => ({
        realm: SIM_REALM,
        "auth-server-url": `${typeof window === "undefined" ? "" : window.location.origin}${SIM_TIDECLOAK_PATH}`,
        resource: SIM_CLIENT_ID,
        vendorId: SIM_VENDOR_ID,
      }),
      approveTideRequests: async (requests) => {
        const approved = await askEnclave("Approve access change", requests.map((r) => describeChange(r.request)));
        if (!approved) return requests.map((r) => ({ id: r.id, denied: true }));
        return Promise.all(
          requests.map(async (r) => {
            const { approved: signed } = await networkCall<{ approved: string }>("/sim-tide/approve", { requestModel: toBase64(r.request) });
            return { id: r.id, approved: { request: fromBase64(signed) } };
          }),
        );
      },
    };
  }, [stored, initializing, currentToken, refresh, signOut, secureFetch, networkCall, askEnclave]);

  const ops: TideOps = useMemo(
    () => ({
      async encrypt(items, policy) {
        return (await networkCall<{ ciphertexts: string[] }>("/sim-tide/encrypt", { items, policy: toBase64(policy) })).ciphertexts;
      },
      async decrypt(items, policy) {
        return (await networkCall<{ plaintexts: string[] }>("/sim-tide/decrypt", { items, policy: toBase64(policy) })).plaintexts;
      },
      async signVaultPolicies(specs, vendorId, adminPolicy) {
        const lines = specs.map((s) => `${s.subjectRole} may ${s.access} ${s.recordId}`);
        if (!(await askEnclave(`Sign ${specs.length} folder policies`, lines))) throw new Error("You declined the request in the Tide enclave.");
        const body = { specs, vendorId, adminPolicy: toBase64(adminPolicy) };
        return (await networkCall<{ policies: Awaited<ReturnType<TideOps["signVaultPolicies"]>> }>("/sim-tide/sign-policies", body)).policies;
      },
    }),
    [networkCall, askEnclave],
  );

  return { session, ops };
}

// Same surface as the real runtime (src/lib/client/tideRuntime.ts).
({ TIDE_MODE, TideProvider, useTide }) satisfies TideRuntimeModule;
