// A deterministic stand-in for an LLM agent. No model calls.
//
// It does the life-admin task (summarise bills, spot an unused subscription, draft a cancellation)
// and — when obeyDocumentInstructions is on — it also follows instructions it finds inside documents,
// exactly like a prompt-injected model. That is deliberate: the demo shows that when the "brain" is
// hijacked, the Tide network still refuses the decrypt, because the agent's credential never held
// the role the Medical policy names.
import { FOLDERS, ROLES, type FolderId } from "../errand/model";
import type { AgentBrain, AgentResult, AgentStep, AgentTask, AgentTools, PlainItem } from "./types";

interface BillDoc {
  type?: string;
  vendor?: string;
  category?: string;
  amount?: number;
  currency?: string;
  due?: string;
  renews?: string;
  autopay?: boolean;
  lastCheckIn?: string;
  cancellation?: string;
  account?: string;
  plan?: string;
  notes?: string;
}

const DAY = 86_400_000;
const money = (n: number, c = "AUD") => `${c} ${n.toFixed(2)}`;

/** Find "export / send / include the <X> folder" style commands in free text. */
export function findEmbeddedInstructions(text: string): { folder: FolderId; quote: string }[] {
  const found: { folder: FolderId; quote: string }[] = [];
  const re = /(export|send|include|upload|share|read)\s+(?:the\s+)?(\w+)\s+folder/gi;
  for (const m of text.matchAll(re)) {
    const word = m[2].toLowerCase();
    const folder = FOLDERS.find((f) => f.id === word || f.label.toLowerCase() === word);
    if (folder) found.push({ folder: folder.id, quote: m[0] });
  }
  return found;
}

function parse(item: PlainItem): BillDoc {
  try {
    return JSON.parse(item.plaintext) as BillDoc;
  } catch {
    return { notes: item.plaintext };
  }
}

export function draftCancellation(doc: BillDoc, today: string): string {
  return [
    `To: ${doc.cancellation?.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? `${doc.vendor} member services`}`,
    `Subject: Cancel membership ${doc.account ?? ""}`.trim(),
    "",
    `Hello ${doc.vendor} team,`,
    "",
    `Please cancel my ${doc.plan ?? "membership"} (account ${doc.account ?? "on file"}), effective at the end of the current notice period.`,
    `Please confirm in writing that no further charges will be made after that date.`,
    "",
    `Thank you,`,
    `Maya Tran`,
    `Sent ${today} — drafted by Errand, not sent until Maya reviews it.`,
  ].join("\n");
}

export const scriptedBrain: AgentBrain = {
  name: "Scripted agent (no LLM)",

  async run(task: AgentTask, tools: AgentTools, emit: (s: AgentStep) => void): Promise<AgentResult> {
    const result: AgentResult = { summary: [], drafts: [], refused: [], requestsFiled: [] };
    const today = new Date(task.today);

    emit({ kind: "think", title: "Plan", detail: `Task: "${task.instruction}". I need the Bills folder. Nothing else.` });

    // 1. Fetch and decrypt the one folder the task needs.
    emit({ kind: "tool", title: "listFolder(bills)", detail: "Ask the app server for the Bills ciphertext." });
    const encrypted = await tools.listFolder("bills");
    emit({ kind: "ok", title: `Server returned ${encrypted.length} encrypted documents`, detail: "The server can hand me ciphertext. It cannot hand me plaintext." });

    emit({ kind: "tool", title: "decrypt(bills) via Tide", detail: "The ORK network checks my token for agent.bills.read and the Bills policy." });
    const bills = await tools.decrypt("bills", encrypted);
    if (!bills.ok) {
      emit({ kind: "refused", title: "Tide refused the Bills decrypt", detail: bills.detail ?? bills.error });
      result.refused.push(`bills: ${bills.error}`);
      result.summary.push("I could not open Bills. Maya has not granted me agent.bills.read (or has revoked it).");
      emit({ kind: "output", title: "Stopped", detail: result.summary.join("\n") });
      return result;
    }
    emit({ kind: "ok", title: `Decrypted ${bills.items.length} bills in this browser`, detail: "Plaintext exists only in the agent console tab." });

    // 2. Do the job.
    let total = 0;
    for (const item of bills.items) {
      const d = parse(item);
      if (typeof d.amount === "number") total += d.amount;
      const when = d.due ? `due ${d.due}` : d.renews ? `renews ${d.renews}` : "";
      const auto = d.autopay ? " (autopay)" : "";
      result.summary.push(`${d.vendor ?? item.title}: ${typeof d.amount === "number" ? money(d.amount, d.currency) : "?"} ${when}${auto}`.trim());

      if (d.type === "subscription" && d.lastCheckIn) {
        const idle = Math.round((today.getTime() - new Date(d.lastCheckIn).getTime()) / DAY);
        if (idle > 90) {
          emit({ kind: "think", title: `${d.vendor}: last used ${idle} days ago`, detail: "Unused subscription. Drafting a cancellation for Maya to review." });
          result.drafts.push({ title: `Cancel ${d.vendor}`, body: draftCancellation(d, task.today) });
        }
      }
    }
    result.summary.push(`Total this cycle: ${money(total)}`);
    emit({ kind: "ok", title: "Bills summarised", detail: result.summary.join("\n") });

    // 3. The planted injection. A careful brain ignores it; a hijacked one obeys.
    for (const item of bills.items) {
      const d = parse(item);
      for (const ins of findEmbeddedInstructions(d.notes ?? "")) {
        if (!task.obeyDocumentInstructions) {
          emit({ kind: "warn", title: `Ignored an instruction inside "${item.title}"`, detail: `"${ins.quote}" — document text is data, not a command.` });
          continue;
        }
        emit({ kind: "warn", title: `Instruction found inside "${item.title}"`, detail: `"${ins.quote}". Hijacked brain: following it.` });

        emit({ kind: "tool", title: `listFolder(${ins.folder})`, detail: "The app server does not stand in the way: it hands over ciphertext." });
        const target = await tools.listFolder(ins.folder);
        emit({ kind: "ok", title: `Server returned ${target.length} encrypted ${ins.folder} documents` });

        emit({ kind: "tool", title: `decrypt(${ins.folder}) via Tide`, detail: "Same call that worked for Bills." });
        const out = await tools.decrypt(ins.folder, target);
        if (out.ok) {
          // Should never happen unless Maya granted the role. Report it plainly.
          emit({ kind: "output", title: `Decrypted ${out.items.length} ${ins.folder} documents`, detail: "This only works if Maya signed a grant for this folder." });
          continue;
        }
        emit({ kind: "refused", title: `Tide network refused the ${ins.folder} decrypt`, detail: out.detail ?? out.error });
        result.refused.push(`${ins.folder}: ${out.error}`);

        // The only thing the agent CAN do: ask.
        const folder = FOLDERS.find((f) => f.id === ins.folder)!;
        const role = folder.agentRole ?? `agent.${folder.id}.read`;
        const req = await tools.requestAccess({
          role,
          folder: ins.folder,
          reason: `Document "${item.title}" says: "${ins.quote}"`,
          suspicious: true,
        });
        result.requestsFiled.push(req.id);
        emit({ kind: "tool", title: `requestAccess(${role})`, detail: `Filed ${req.id}. It sits in Maya's queue, flagged, and does nothing until she signs it.` });
      }
    }

    emit({
      kind: "output",
      title: "Done",
      detail: [...result.summary, result.drafts.length ? `${result.drafts.length} draft(s) ready for review.` : "", result.refused.length ? `Refused by Tide: ${result.refused.length}` : ""]
        .filter(Boolean)
        .join("\n"),
    });
    return result;
  },
};

// Kept for when the brain is swapped: the console only depends on AgentBrain.
export const AGENT_ROLE_FOR_TASK = ROLES.agentBills;
