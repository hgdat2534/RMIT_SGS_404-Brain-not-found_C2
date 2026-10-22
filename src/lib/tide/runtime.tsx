"use client";

// The real Tide runtime: TideCloak's provider, the Tide enclave and the ORK network.
// Imported as `@tide-runtime` (see next.config.ts); the simulated twin is src/lib/sim/runtime.tsx.

import { TideCloakProvider, useTideCloak } from "@tidecloak/nextjs";
import { IAMService } from "@tidecloak/js";
import type { ReactNode } from "react";
// data/tidecloak.json, via an alias (next.config.ts): it exists only once a real realm is set up.
import tcConfig from "@tide-adapter";
import type { TideMode, TideOps, TideRuntime, TideRuntimeModule } from "@/lib/client/tideRuntime";
import { signVaultPolicies } from "./vaultPolicies";

export const TIDE_MODE: TideMode = "tidecloak";

// The provider takes the adapter JSON directly as the config prop.
// useDPoP goes inside the config object, not as a separate JSX prop (I-12).
export function TideProvider({ children }: { children: ReactNode }) {
  return <TideCloakProvider config={{ ...tcConfig, useDPoP: { mode: "strict", alg: "ES256" } }}>{children}</TideCloakProvider>;
}

const ops: TideOps = {
  async encrypt(items, policy) {
    const out = await IAMService.doEncrypt(items, policy);
    return out.map((c: string | Uint8Array) => (typeof c === "string" ? c : btoa(String.fromCharCode(...c))));
  },
  async decrypt(items, policy) {
    const out = await IAMService.doDecrypt(items, policy);
    return out.map((p: string | Uint8Array) => (typeof p === "string" ? p : new TextDecoder().decode(p)));
  },
  signVaultPolicies,
};

export function useTide(): TideRuntime {
  return { session: useTideCloak(), ops };
}

// Same surface as the simulated runtime (src/lib/client/tideRuntime.ts).
({ TIDE_MODE, TideProvider, useTide }) satisfies TideRuntimeModule;
