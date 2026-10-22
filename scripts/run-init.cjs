// Runs scripts/init-tidecloak.sh with a real bash.
//
// On Windows, `bash` from PowerShell or cmd is usually WSL's launcher (C:\Windows\System32\bash.exe),
// which fails without a Linux distro installed. Prefer Git Bash, which ships with Git for Windows.
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

function findBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    process.env.GIT_BASH,
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error("Git Bash not found. Install Git for Windows (https://git-scm.com) or set GIT_BASH to bash.exe.");
    process.exit(1);
  }
  return found;
}

const TRANSIENT_LICENSE_FAILURE = 3; // init-tidecloak.sh: Tide licensing failed upstream, safe to start over
// Midgard has been seen answering 500, then 503 for stretches of time: be patient by default.
const MAX_ATTEMPTS = Number(process.env.INIT_MAX_ATTEMPTS) || 8;
const RETRY_DELAY_SECONDS = Number(process.env.INIT_RETRY_DELAY_SECONDS) || 90;

const script = path.join(__dirname, "init-tidecloak.sh");
const bash = findBash();
let status = 1;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  status = spawnSync(bash, [script, ...process.argv.slice(2)], { stdio: "inherit", env: process.env }).status ?? 1;
  if (status !== TRANSIENT_LICENSE_FAILURE) break;
  if (attempt < MAX_ATTEMPTS) {
    console.log(`\n==> Tide licensing failed upstream (transient). Starting over from a clean realm in ${RETRY_DELAY_SECONDS}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})...\n`);
    spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${RETRY_DELAY_SECONDS * 1000})`]);
  } else {
    console.error(`\nTide licensing failed ${MAX_ATTEMPTS} times. Wait a few minutes and run 'npm run init' again; if it keeps failing, contact the Tide team (Discord or info@tide.org).`);
  }
}
process.exit(status);
