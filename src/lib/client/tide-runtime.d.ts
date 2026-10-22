// Types for the `@tide-runtime` alias (next.config.ts). Both runtimes are checked against
// TideRuntimeModule in their own files, so this is all the pages get to see.
// The adapter JSON `npm run init` exports for a real realm (data/tidecloak.json). Only the real
// runtime imports it, so a simulated build never needs the file.
declare module "@tide-adapter" {
  const config: Record<string, unknown>;
  export default config;
}

declare module "@tide-runtime" {
  import type { TideRuntimeModule } from "@/lib/client/tideRuntime";
  export const TIDE_MODE: TideRuntimeModule["TIDE_MODE"];
  export const TideProvider: TideRuntimeModule["TideProvider"];
  export const useTide: TideRuntimeModule["useTide"];
}
