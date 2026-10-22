// How loudly Maya's approval queue should flag a change request.
//
// This is advice for the human approver, not a security control: whatever the flag says, nothing
// happens until Maya signs the change request in the Tide enclave.

import { getFolder, type FolderId } from "./folders";

export type Requester = "owner" | "agent" | "operator";
export type ChangeKind = "grant" | "revoke";
export type RiskLevel = "red" | "amber" | "green";

export interface RequestTrigger {
  docId: string;
  excerpt: string;
}

export interface RiskInput {
  kind: ChangeKind;
  folderId: FolderId;
  requestedBy: Requester;
  /** The folders the task the owner gave the agent actually needs. */
  taskScope?: FolderId[];
  /** Set when the request was prompted by text found inside a document. */
  trigger?: RequestTrigger;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const folder = getFolder(input.folderId);
  const red: string[] = [];
  const amber: string[] = [];

  if (input.kind === "revoke") {
    return { level: "green", reasons: [`Removes the agent's access to ${folder.label}.`] };
  }

  if (folder.sensitivity === "high") red.push(`${folder.label} is a high-sensitivity folder.`);
  if (input.requestedBy === "operator") red.push("Filed by the platform operator, not by you.");
  if (input.requestedBy === "agent") amber.push("Requested by the agent itself.");
  if (input.trigger) red.push(`Prompted by text inside a document (possible prompt injection): "${input.trigger.excerpt}"`);
  if (input.taskScope && !input.taskScope.includes(input.folderId)) {
    red.push(`Outside the task you gave Errand (${input.taskScope.join(", ")}).`);
  }

  if (red.length) return { level: "red", reasons: [...red, ...amber] };
  if (amber.length) return { level: "amber", reasons: amber };
  return { level: "green", reasons: [`You asked to give the agent read access to ${folder.label}.`] };
}
