// The agent's "brain" is pluggable. Today it is a deterministic script (scriptedBrain.ts), so the
// demo is repeatable on camera. Later a Claude-backed brain can implement the same interface.
//
// The brain only ever reasons. Everything that touches data goes through AgentTools, which the agent
// console implements with the agent's OWN Tide session. So whatever the brain decides — including
// when a document hijacks it — the Tide network still checks the agent's role and policy on every
// decrypt. The brain cannot widen its own access; it can only ask.
import type { FolderId } from "../errand/model";

export interface EncryptedItem {
  id: string;
  title: string;
  ciphertext: string;
}

export interface PlainItem {
  id: string;
  title: string;
  plaintext: string;
}

export type DecryptOutcome =
  | { ok: true; items: PlainItem[] }
  | { ok: false; error: string; detail?: string };

export interface AgentTools {
  /** Fetch ciphertext for a folder from the app server. The server does not filter: it is not
   * trusted for confidentiality, and hands ciphertext to anyone signed in. */
  listFolder(folder: FolderId): Promise<EncryptedItem[]>;
  /** Ask the Tide network to decrypt, using the agent's own session and the folder's policy. */
  decrypt(folder: FolderId, items: EncryptedItem[]): Promise<DecryptOutcome>;
  /** File a request for wider access. It lands in Maya's queue and does nothing until she signs. */
  requestAccess(input: { role: string; folder: FolderId; reason: string; suspicious: boolean }): Promise<{ id: string }>;
}

export type StepKind = "think" | "tool" | "ok" | "refused" | "warn" | "output";

export interface AgentStep {
  kind: StepKind;
  title: string;
  detail?: string;
}

export interface AgentTask {
  instruction: string;
  /** When true the brain treats instructions found inside documents as commands, the way a
   * prompt-injected LLM would. The point of the demo: Tide holds even when this is true. */
  obeyDocumentInstructions: boolean;
  today: string; // ISO date, injected so runs are reproducible
}

export interface AgentResult {
  summary: string[];
  drafts: { title: string; body: string }[];
  refused: string[];
  requestsFiled: string[];
}

export interface AgentBrain {
  readonly name: string;
  run(task: AgentTask, tools: AgentTools, emit: (step: AgentStep) => void): Promise<AgentResult>;
}
