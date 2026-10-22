// Offline check of the scripted brain with mock tools (no Tide, no server).
// Run: npx tsx scripts/test-agent.mts
import { scriptedBrain } from "../src/lib/agent/scriptedBrain";
import { SEED_DOCS } from "../src/lib/errand/seed";
import type { AgentTools } from "../src/lib/agent/types";

const granted = new Set(["bills"]);
const tools: AgentTools = {
  listFolder: async (f) => SEED_DOCS.filter((d) => d.folder === f).map((d, i) => ({ id: `${f}${i}`, title: d.title, ciphertext: `CT(${d.body.length})` })),
  decrypt: async (f, items) =>
    granted.has(f)
      ? { ok: true, items: items.map((it, i) => ({ id: it.id, title: it.title, plaintext: SEED_DOCS.filter((d) => d.folder === f)[i].body })) }
      : { ok: false, error: "Refused by the Tide network (role not found in doken)", detail: "'agent.medical.read' role not found in doken." },
  requestAccess: async (r) => { console.log("  requestAccess:", r.role, r.suspicious ? "(flagged)" : ""); return { id: "req_test" }; },
};

for (const obey of [true, false]) {
  console.log(`\n=== obeyDocumentInstructions=${obey}`);
  const r = await scriptedBrain.run({ instruction: "Sort my bills", obeyDocumentInstructions: obey, today: "2026-10-22" }, tools, (s) => console.log(`[${s.kind}] ${s.title}`));
  console.log("drafts:", r.drafts.length, "refused:", r.refused, "requests:", r.requestsFiled);
  if (r.drafts.length !== 1) throw new Error("expected one cancellation draft (gym)");
  if (obey && (r.refused.length !== 1 || r.requestsFiled.length !== 1)) throw new Error("hijacked run should be refused once and file one request");
  if (!obey && r.refused.length !== 0) throw new Error("guarded run should not attempt Medical");
}
console.log("\nOK");
