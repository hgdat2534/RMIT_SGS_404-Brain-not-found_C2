// Runs `next <args>` with NEXT_PUBLIC_TIDE_MODE=simulated: TideCloak, the Tide enclave and the ORK
// network are replaced by the in-process stand-ins in src/lib/sim. No Docker, no Tide account.
// (A wrapper rather than `VAR=x next ...` so it works the same from PowerShell, cmd and bash.)
const { spawnSync } = require("node:child_process");

const next = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [next, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_TIDE_MODE: "simulated" },
});
process.exit(result.status ?? 1);
