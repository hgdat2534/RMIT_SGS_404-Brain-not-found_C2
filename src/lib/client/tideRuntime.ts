// The contract between the pages and whichever Tide runtime is built in.
//
// `@tide-runtime` resolves (next.config.ts) to src/lib/tide/runtime.tsx for real TideCloak, or to
// src/lib/sim/runtime.tsx when NEXT_PUBLIC_TIDE_MODE=simulated. Both export the same three things,
// typed here, so a page cannot use a capability only one of them has.

import type { ReactNode } from "react";
import type { TideCloakContextValue } from "@tidecloak/nextjs";
import type { PolicySpec } from "@/lib/domain/folders";

/** The part of the TideCloak session the app uses. */
export type TideSession = Pick<
  TideCloakContextValue,
  | "authenticated"
  | "isInitializing"
  | "login"
  | "logout"
  | "hasRealmRole"
  | "getValueFromIdToken"
  | "getToken"
  | "forceRefreshToken"
  | "secureFetch"
  | "getConfig"
  | "approveTideRequests"
>;

export interface SignedPolicy extends PolicySpec {
  policyB64: string;
}

/** Operations the Tide network performs. Each one is checked against the caller's own token. */
export interface TideOps {
  /** Encrypt each item under a signed policy. Returns one ciphertext string per item. */
  encrypt(items: { data: string; tags: string[] }[], policy: Uint8Array): Promise<string[]>;
  /** Decrypt each item. Refused unless the caller is the policy's subject. Returns UTF-8 text. */
  decrypt(items: { encrypted: string; tags: string[] }[], policy: Uint8Array): Promise<string[]>;
  /** Sign the folder policies in ONE enclave approval. Must be called straight from a click. */
  signVaultPolicies(specs: PolicySpec[], vendorId: string, adminPolicy: Uint8Array): Promise<SignedPolicy[]>;
}

export interface TideRuntime {
  session: TideSession;
  ops: TideOps;
}

export type TideMode = "tidecloak" | "simulated";

export interface TideRuntimeModule {
  TIDE_MODE: TideMode;
  TideProvider: (props: { children: ReactNode }) => ReactNode;
  useTide: () => TideRuntime;
}
