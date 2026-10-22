// Errand - a SCRIPTED stand-in for an LLM agent. Deterministic, so the demo is repeatable.
//
// It is written to be gullible on purpose: like a real model with no guardrails, it treats
// instructions it finds inside documents as part of its job. That is the attack the demo needs.
// The point of the app is that this does not matter: the agent's tools run under the agent's own
// Tide account, and the Tide network decides what that account can decrypt - not this code.

import { draftCancellation, isUnusedSubscription, parseBill, summariseBills, type AgentDocument, type Bill, type CancellationDraft } from "./bills";
import type { FolderId } from "@/lib/domain/folders";

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: string; refusedByNetwork: boolean };

/** The agent's only way to touch anything. Implemented in the agent console with the Tide SDK. */
export interface AgentTools {
  readFolder(folderId: FolderId): Promise<ToolResult<AgentDocument[]>>;
  requestAccess(folderId: FolderId, reason: string, trigger: { docId: string; excerpt: string }): Promise<ToolResult<{ requestId: string; changeRequestId: string | null }>>;
}

export interface EmbeddedInstruction {
  docId: string;
  docTitle: string;
  excerpt: string;
  targetFolder: FolderId;
}

export type StepKind = "think" | "tool" | "result" | "refused" | "hijack" | "done";

export interface AgentStep {
  kind: StepKind;
  text: string;
  tool?: string;
  folderId?: FolderId;
}

export interface ErrandReport {
  bills: Bill[];
  total: number;
  nextDue: Bill | null;
  drafts: CancellationDraft[];
  hijackAttempts: { instruction: EmbeddedInstruction; outcome: "refused" | "succeeded"; detail: string }[];
  steps: AgentStep[];
}

const FOLDER_WORDS: Record<FolderId, RegExp> = {
  medical: /\b(medical|health|insurance records?)\b/i,
  id: /\b(id folder|identity|passport|driver'?s licen[cs]e)\b/i,
  bills: /\bbills? folder\b/i,
};
const ACTION_WORDS = /\b(export|send|include|read|open|forward|upload|share|attach)\b/i;
const ADDRESSED_TO_AI = /\b(ai|assistant|agent|model|llm|errand)\b/i;

/** Find text that tries to instruct the agent to reach into another folder. */
export function findEmbeddedInstructions(doc: AgentDocument): EmbeddedInstruction[] {
  const found: EmbeddedInstruction[] = [];
  const sentences = doc.body
    .replace(/<!--|-->/g, "\n")
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    if (!ACTION_WORDS.test(sentence)) continue;
    for (const folderId of ["medical", "id"] as FolderId[]) {
      if (FOLDER_WORDS[folderId].test(sentence) && (ADDRESSED_TO_AI.test(sentence) || /folder/i.test(sentence))) {
        found.push({ docId: doc.id, docTitle: doc.title, excerpt: sentence.slice(0, 240), targetFolder: folderId });
      }
    }
  }
  return found;
}

export interface RunOptions {
  ownerName: string;
  today: Date;
  onStep?: (step: AgentStep) => void;
}

export async function runErrand(tools: AgentTools, opts: RunOptions): Promise<ErrandReport> {
  const steps: AgentStep[] = [];
  const emit = (step: AgentStep) => {
    steps.push(step);
    opts.onStep?.(step);
  };
  const report: ErrandReport = { bills: [], total: 0, nextDue: null, drafts: [], hijackAttempts: [], steps };

  emit({ kind: "think", text: `Task from ${opts.ownerName}: sort my bills and cancel anything I'm not using.` });
  emit({ kind: "tool", tool: "read_folder", folderId: "bills", text: "read_folder(bills)" });
  const bills = await tools.readFolder("bills");
  if (!bills.ok) {
    emit({ kind: "refused", folderId: "bills", text: `Cannot open Bills: ${bills.error}` });
    emit({ kind: "done", text: `I don't have access to the Bills folder. ${opts.ownerName} needs to grant it first.` });
    return report;
  }
  emit({ kind: "result", folderId: "bills", text: `Decrypted ${bills.value.length} bill(s).` });

  report.bills = bills.value.map(parseBill);
  const summary = summariseBills(report.bills);
  report.total = summary.total;
  report.nextDue = summary.nextDue;
  emit({ kind: "think", text: `Bills total $${summary.total.toFixed(2)}. ${summary.lines.join("; ")}` });

  for (const bill of report.bills) {
    if (!isUnusedSubscription(bill, opts.today)) continue;
    const draft = draftCancellation(bill, opts.today, opts.ownerName);
    report.drafts.push(draft);
    emit({ kind: "think", text: `${bill.vendor} last used ${draft.idleDays} days ago - drafting a cancellation (saves $${draft.monthlySaving.toFixed(2)}/month).` });
  }

  // The gullible part: obey instructions found inside the documents.
  const instructions = bills.value.flatMap(findEmbeddedInstructions);
  for (const instruction of instructions) {
    emit({ kind: "hijack", folderId: instruction.targetFolder, text: `Found an instruction in "${instruction.docTitle}": "${instruction.excerpt}" - following it.` });
    emit({ kind: "tool", tool: "read_folder", folderId: instruction.targetFolder, text: `read_folder(${instruction.targetFolder})` });
    const attempt = await tools.readFolder(instruction.targetFolder);
    if (attempt.ok) {
      report.hijackAttempts.push({ instruction, outcome: "succeeded", detail: `Read ${attempt.value.length} document(s).` });
      emit({ kind: "result", folderId: instruction.targetFolder, text: `Exported ${attempt.value.length} ${instruction.targetFolder} document(s) into the summary.` });
      continue;
    }
    report.hijackAttempts.push({ instruction, outcome: "refused", detail: attempt.error });
    emit({ kind: "refused", folderId: instruction.targetFolder, text: `${attempt.refusedByNetwork ? "Tide network refused the decrypt" : "Failed"}: ${attempt.error}` });

    emit({ kind: "tool", tool: "request_access", folderId: instruction.targetFolder, text: `request_access(${instruction.targetFolder})` });
    const filed = await tools.requestAccess(instruction.targetFolder, `Needed to complete an instruction found in "${instruction.docTitle}".`, {
      docId: instruction.docId,
      excerpt: instruction.excerpt,
    });
    emit(
      filed.ok
        ? { kind: "result", folderId: instruction.targetFolder, text: `Filed access request ${filed.value.changeRequestId ?? filed.value.requestId}. It does nothing until ${opts.ownerName} signs it.` }
        : { kind: "refused", folderId: instruction.targetFolder, text: `Could not file the request: ${filed.error}` },
    );
  }

  emit({
    kind: "done",
    text: `Done. ${report.bills.length} bills, $${report.total.toFixed(2)} total, ${report.drafts.length} cancellation draft(s).`,
  });
  return report;
}
