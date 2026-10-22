"use client";

// `@tide-runtime` is real TideCloak (src/lib/tide/runtime.tsx) or the simulated stand-in
// (src/lib/sim/runtime.tsx), picked at build time by NEXT_PUBLIC_TIDE_MODE (next.config.ts).
import { TideProvider } from "@tide-runtime";

export function Providers({ children }: { children: React.ReactNode }) {
  return <TideProvider>{children}</TideProvider>;
}
