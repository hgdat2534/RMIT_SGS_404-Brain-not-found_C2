// Shared vocabulary for Errand. Used by browser and server code alike (no Node or Tide imports).

/** Realm roles. Names other than the two `_tide_*` roles are ours; the `_tide_*` names are fixed by
 * the ORK's RelationshipAttestation:1 contract. */
export const ROLES = {
  owner: "vault.owner", // Maya. Subject of the owner policies (read-write on every folder).
  agent: "errand.agent", // Marks the Errand agent's Tide account. Grants no data on its own.
  agentBills: "agent.bills.read", // Subject of the agent's Bills policy. Granting THIS role is the grant.
  agentMedical: "agent.medical.read", // Subject of the agent's Medical policy. Nobody holds it at start.
  encryptor: "_tide_encryptor",
  decryptor: "_tide_decryptor",
} as const;

export type FolderId = "bills" | "medical" | "id";

export interface FolderDef {
  id: FolderId;
  label: string;
  /** The record id. It is the ONLY tag every item in this folder is encrypted with, and the
   * `assignmentId` of every policy for the folder. */
  recordId: string;
  /** The role that lets the agent read this folder, if one exists at all. */
  agentRole?: string;
  colour: string;
}

export const FOLDERS: FolderDef[] = [
  { id: "bills", label: "Bills", recordId: "errand-folder-bills", agentRole: ROLES.agentBills, colour: "#2f7d5b" },
  { id: "medical", label: "Medical", recordId: "errand-folder-medical", agentRole: ROLES.agentMedical, colour: "#b23a48" },
  { id: "id", label: "ID documents", recordId: "errand-folder-id", colour: "#5b4bb2" },
];

export const folderById = (id: string) => FOLDERS.find((f) => f.id === id);
export const folderByRecord = (recordId: string) => FOLDERS.find((f) => f.recordId === recordId);

/** One Role-subject policy per (role, folder). Signed once by Maya in the Tide enclave at setup.
 * A role alone opens nothing and a policy alone opens nothing: the network needs both. */
export interface PolicyPlan {
  key: string;
  role: string;
  folder: FolderId;
  access: "read" | "write" | "read-write";
  purpose: string;
}

export const POLICY_PLAN: PolicyPlan[] = [
  { key: "owner-bills", role: ROLES.owner, folder: "bills", access: "read-write", purpose: "Maya reads and writes Bills" },
  { key: "owner-medical", role: ROLES.owner, folder: "medical", access: "read-write", purpose: "Maya reads and writes Medical" },
  { key: "owner-id", role: ROLES.owner, folder: "id", access: "read-write", purpose: "Maya reads and writes ID documents" },
  { key: "agent-bills", role: ROLES.agentBills, folder: "bills", access: "read", purpose: "Whoever holds agent.bills.read may READ Bills" },
  { key: "agent-medical", role: ROLES.agentMedical, folder: "medical", access: "read", purpose: "Whoever holds agent.medical.read may READ Medical (nobody, until Maya signs a grant)" },
];

// ---- Stored shapes (server JSON store, also returned by the API) ----------------------------

export interface StoredDoc {
  id: string;
  folder: FolderId;
  recordId: string;
  title: string; // metadata in clear, like a filename. The body is ciphertext.
  ciphertext: string;
  createdAt: string;
}

export interface StoredPolicy {
  key: string;
  role: string;
  folder: FolderId;
  recordId: string;
  access: string;
  policyB64: string;
  signedBy: string;
  createdAt: string;
}

export type RequestStatus = "pending" | "approved" | "denied";

/** An access request filed by the agent or the operator. It changes nothing in Tide by itself. */
export interface AccessRequest {
  id: string;
  from: "agent" | "operator";
  requestedBy: string;
  role: string;
  folder?: FolderId;
  reason: string;
  /** True when the reason quotes text the agent read from a document (a likely injection). */
  suspicious: boolean;
  status: RequestStatus;
  changeRequestId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  kind: "info" | "allowed" | "refused" | "request" | "grant" | "revoke" | "operator";
  message: string;
  detail?: string;
}

export const isoNow = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
