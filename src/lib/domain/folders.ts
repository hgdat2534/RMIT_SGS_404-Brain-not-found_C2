// The vault's folders and the roles that govern them.
//
// Every folder is ONE Tide record (its recordId is the only tag on every item in it). Each folder
// gets RelationshipAttestation policies with a Role subject:
//   - OWNER_ROLE           read-write  (Maya)
//   - folder.agentRole     read-only   (whoever holds it - only ever the Errand agent account)
//   - folder.householdRole read-only   (Bills only: the people Maya shares the household bills with)
// Who holds a folder role is decided by IGA change requests that only Maya can sign, so granting or
// revoking access to a folder is a role change, never a new policy.
//
// A role alone opens nothing and a policy alone opens nothing (Tide pack, relationship-attestation
// role matrix): a reader also needs the realm role DECRYPTOR_ROLE, a writer ENCRYPTOR_ROLE.

export type FolderId = "bills" | "medical" | "id";
export type Sensitivity = "low" | "high";

export interface Folder {
  id: FolderId;
  label: string;
  description: string;
  recordId: string;
  agentRole: string;
  householdRole?: string;
  sensitivity: Sensitivity;
}

export const OWNER_ROLE = "vault.owner";
export const AGENT_ROLE = "errand.agent"; // identity marker for the agent account; grants no data
export const HOUSEHOLD_ROLE = "household.member"; // identity marker; the folder role is what opens data
export const AUDITOR_ROLE = "vault.auditor"; // may read the activity log, never a document
export const SUPPORT_ROLE = "platform.support"; // works for the company running Errand
export const ADMIN_ROLE = "tide-realm-admin"; // client role on realm-management: approves changes
export const DECRYPTOR_ROLE = "_tide_decryptor";
export const ENCRYPTOR_ROLE = "_tide_encryptor";

export const FOLDERS: Folder[] = [
  {
    id: "bills",
    label: "Bills",
    description: "Utility, phone and subscription bills",
    recordId: "errand-folder-bills",
    agentRole: "agent.bills.read",
    householdRole: "household.bills.read",
    sensitivity: "low",
  },
  {
    id: "medical",
    label: "Medical",
    description: "Insurance, prescriptions and test results",
    recordId: "errand-folder-medical",
    agentRole: "agent.medical.read",
    sensitivity: "high",
  },
  {
    id: "id",
    label: "ID",
    description: "Passport and driver's licence scans",
    recordId: "errand-folder-id",
    agentRole: "agent.id.read",
    sensitivity: "high",
  },
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
    ...(f.householdRole ? [{ folderId: f.id, recordId: f.recordId, subjectRole: f.householdRole, access: "read" as const }] : []),
  ]);
}

export function isRequiredPolicy(spec: { folderId: unknown; recordId: unknown; subjectRole: unknown; access: unknown }): boolean {
  return requiredPolicies().some(
    (p) => p.folderId === spec.folderId && p.recordId === spec.recordId && p.subjectRole === spec.subjectRole && p.access === spec.access,
  );
}
