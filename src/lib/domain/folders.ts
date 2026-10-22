// The vault's folders and the roles that govern them.
//
// Every folder is ONE Tide record (its recordId is the only tag on every item in it). Each folder
// gets two RelationshipAttestation policies, both with a Role subject:
//   - OWNER_ROLE      read-write  (Maya)
//   - folder.agentRole read-only  (whoever holds it - only ever the Errand agent account)
// Who holds agentRole is decided by IGA change requests that only Maya can sign, so granting or
// revoking the agent's access to a folder is a role change, never a new policy.

export type FolderId = "bills" | "medical" | "id";
export type Sensitivity = "low" | "high";

export interface Folder {
  id: FolderId;
  label: string;
  recordId: string;
  agentRole: string;
  sensitivity: Sensitivity;
}

export const OWNER_ROLE = "vault.owner";
export const AGENT_ROLE = "errand.agent"; // identity marker for the agent account; grants no data

export const FOLDERS: Folder[] = [
  { id: "bills", label: "Bills", recordId: "errand-folder-bills", agentRole: "agent.bills.read", sensitivity: "low" },
  { id: "medical", label: "Medical", recordId: "errand-folder-medical", agentRole: "agent.medical.read", sensitivity: "high" },
  { id: "id", label: "ID", recordId: "errand-folder-id", agentRole: "agent.id.read", sensitivity: "high" },
];

export function isFolderId(value: unknown): value is FolderId {
  return typeof value === "string" && FOLDERS.some((f) => f.id === value);
}

export function getFolder(id: FolderId): Folder {
  const folder = FOLDERS.find((f) => f.id === id);
  if (!folder) throw new Error(`unknown folder: ${id}`);
  return folder;
}

export function folderForAgentRole(role: string): Folder | undefined {
  return FOLDERS.find((f) => f.agentRole === role);
}

export type PolicyAccess = "read" | "read-write";

export interface PolicySpec {
  folderId: FolderId;
  recordId: string;
  subjectRole: string;
  access: PolicyAccess;
}

// The full set of policies the vault needs. Maya signs all of them once, in one enclave approval.
export function requiredPolicies(): PolicySpec[] {
  return FOLDERS.flatMap((f) => [
    { folderId: f.id, recordId: f.recordId, subjectRole: OWNER_ROLE, access: "read-write" as const },
    { folderId: f.id, recordId: f.recordId, subjectRole: f.agentRole, access: "read" as const },
  ]);
}

export function isRequiredPolicy(spec: { folderId: unknown; recordId: unknown; subjectRole: unknown; access: unknown }): boolean {
  return requiredPolicies().some(
    (p) => p.folderId === spec.folderId && p.recordId === spec.recordId && p.subjectRole === spec.subjectRole && p.access === spec.access,
  );
}
