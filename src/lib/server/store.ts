// File-backed store. Survives Next.js dev hot reload (in-memory state does not).
//
// What lives here is exactly what the operator can see: ciphertext, signed policies (which are
// public by design - they only say WHO may open a record), change-request bookkeeping and the
// audit log. No plaintext document ever reaches this file.

import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { FolderId, PolicyAccess } from "@/lib/domain/folders";
import type { ChangeKind, Requester, RequestTrigger, RiskAssessment } from "@/lib/domain/risk";

export interface StoredDocument {
  id: string;
  folderId: FolderId;
  ciphertext: string;
  createdAt: string;
}

export interface StoredPolicy {
  folderId: FolderId;
  recordId: string;
  subjectRole: string;
  access: PolicyAccess;
  policyB64: string;
  grantedBy: string;
  createdAt: string;
}

export type RequestStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED" | "FAILED";

export interface AccessRequest {
  id: string;
  changeRequestId: string | null;
  kind: ChangeKind;
  folderId: FolderId;
  role: string;
  requestedBy: Requester;
  requesterName: string;
  reason: string;
  trigger?: RequestTrigger;
  risk: RiskAssessment;
  status: RequestStatus;
  error?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  folderId?: FolderId;
  outcome: "allowed" | "refused" | "queued" | "info";
  detail: string;
}

export interface StoreData {
  documents: StoredDocument[];
  policies: StoredPolicy[];
  requests: AccessRequest[];
  audit: AuditEntry[];
}

const EMPTY: StoreData = { documents: [], policies: [], requests: [], audit: [] };
const MAX_AUDIT = 500;

export class Store {
  constructor(private readonly filePath: string) {}

  read(): StoreData {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<StoreData>;
      return { ...EMPTY, ...parsed };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  /** Read-modify-write. Node runs route handlers on one thread, so a sync update cannot interleave. */
  update<T>(mutate: (data: StoreData) => T): T {
    const data = this.read();
    const result = mutate(data);
    if (data.audit.length > MAX_AUDIT) data.audit = data.audit.slice(-MAX_AUDIT);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.filePath);
    return result;
  }

  // --- documents ---------------------------------------------------------------------------

  listDocuments(folderId?: FolderId): StoredDocument[] {
    const docs = this.read().documents;
    return folderId ? docs.filter((d) => d.folderId === folderId) : docs;
  }

  /** Replace a folder's contents with freshly encrypted documents. */
  replaceFolder(folderId: FolderId, ciphertexts: string[]): StoredDocument[] {
    return this.update((data) => {
      const now = new Date().toISOString();
      const fresh = ciphertexts.map((ciphertext) => ({ id: randomUUID(), folderId, ciphertext, createdAt: now }));
      data.documents = [...data.documents.filter((d) => d.folderId !== folderId), ...fresh];
      return fresh;
    });
  }

  // --- policies ----------------------------------------------------------------------------

  listPolicies(folderId?: FolderId): StoredPolicy[] {
    const policies = this.read().policies;
    return folderId ? policies.filter((p) => p.folderId === folderId) : policies;
  }

  /** One policy per (folder, subject role); a re-signed policy replaces the old one. */
  upsertPolicy(policy: StoredPolicy): void {
    this.update((data) => {
      data.policies = data.policies.filter((p) => !(p.folderId === policy.folderId && p.subjectRole === policy.subjectRole));
      data.policies.push(policy);
    });
  }

  // --- requests ----------------------------------------------------------------------------

  listRequests(): AccessRequest[] {
    return this.read().requests;
  }

  addRequest(request: Omit<AccessRequest, "id" | "createdAt">): AccessRequest {
    return this.update((data) => {
      const full: AccessRequest = { ...request, id: randomUUID(), createdAt: new Date().toISOString() };
      data.requests.push(full);
      return full;
    });
  }

  setRequestStatus(id: string, status: RequestStatus): AccessRequest | undefined {
    return this.update((data) => {
      const req = data.requests.find((r) => r.id === id);
      if (!req || req.status === status) return req;
      req.status = status;
      if (status !== "PENDING") req.resolvedAt = new Date().toISOString();
      return req;
    });
  }

  // --- audit -------------------------------------------------------------------------------

  listAudit(): AuditEntry[] {
    return this.read().audit;
  }

  addAudit(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
    return this.update((data) => {
      const full: AuditEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
      data.audit.push(full);
      return full;
    });
  }
}

let _store: Store | null = null;

export function getStore(): Store {
  if (!_store) {
    const file = process.env.ERRAND_STORE_FILE || join(process.cwd(), "data", "store", "errand.json");
    _store = new Store(file);
  }
  return _store;
}
