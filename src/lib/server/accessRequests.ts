// Filing and tracking requests to change what the agent may open.
//
// Every path that widens or narrows the agent's access - Maya's own grant button, the agent asking
// for more, the operator's "grant" button - ends in the same place: a TideCloak change request that
// only Maya can sign. The difference between them is only the risk flag her queue shows.

import { getFolder, type FolderId } from "@/lib/domain/folders";
import { assessRisk, type ChangeKind, type Requester, type RequestTrigger } from "@/lib/domain/risk";
import { AGENT_USERNAME, ChangeConflictError, getAdmin, type TidecloakAdmin } from "./tidecloakAdmin";
import { getStore, type AccessRequest, type Store } from "./store";

export interface FileChangeInput {
  kind: ChangeKind;
  folderId: FolderId;
  requestedBy: Requester;
  requesterName: string;
  reason: string;
  trigger?: RequestTrigger;
  taskScope?: FolderId[];
}

export interface Deps {
  store: Store;
  admin: Pick<TidecloakAdmin, "findUserId" | "proposeRealmRoleChange" | "getChangeRequest" | "getUserRealmRoles">;
  agentUsername: string;
}

function defaultDeps(): Deps {
  return { store: getStore(), admin: getAdmin(), agentUsername: AGENT_USERNAME };
}

export async function fileAccessChange(input: FileChangeInput, deps: Deps = defaultDeps()): Promise<AccessRequest> {
  const folder = getFolder(input.folderId);
  const risk = assessRisk(input);
  const base = {
    kind: input.kind,
    folderId: input.folderId,
    role: folder.agentRole,
    requestedBy: input.requestedBy,
    requesterName: input.requesterName,
    reason: input.reason,
    trigger: input.trigger,
    risk,
  };

  try {
    const agentId = await deps.admin.findUserId(deps.agentUsername);
    const filed = await deps.admin.proposeRealmRoleChange(agentId, folder.agentRole, input.kind);
    const request = deps.store.addRequest({
      ...base,
      changeRequestId: filed.changeRequestId,
      // IGA off would apply the change at once. The pack's realm always has IGA on, so this is a
      // misconfiguration worth seeing in the queue, not a success to hide.
      status: filed.applied ? "APPROVED" : "PENDING",
      error: filed.applied ? "Applied without approval: IGA is not enabled on this realm." : undefined,
    });
    deps.store.addAudit({
      actor: input.requesterName,
      action: `file ${input.kind} ${folder.agentRole}`,
      folderId: input.folderId,
      outcome: "queued",
      detail: `Change request ${filed.changeRequestId ?? "(none)"} waits for the owner's signature. Risk: ${risk.level}.`,
    });
    return request;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const request = deps.store.addRequest({ ...base, changeRequestId: null, status: "FAILED", error: message });
    deps.store.addAudit({
      actor: input.requesterName,
      action: `file ${input.kind} ${folder.agentRole}`,
      folderId: input.folderId,
      outcome: "refused",
      detail: message,
    });
    if (err instanceof ChangeConflictError) return request;
    throw Object.assign(new Error(message), { request });
  }
}

/** Pull the live status of every pending request from TideCloak, the source of truth. */
export async function syncRequests(deps: Deps = defaultDeps()): Promise<AccessRequest[]> {
  for (const req of deps.store.listRequests()) {
    if (req.status !== "PENDING" || !req.changeRequestId) continue;
    try {
      const cr = await deps.admin.getChangeRequest(req.changeRequestId);
      if (!cr) deps.store.setRequestStatus(req.id, "CANCELLED");
      else if (cr.status !== "PENDING") deps.store.setRequestStatus(req.id, cr.status);
    } catch {
      // TideCloak unreachable: keep the last known status rather than guessing.
    }
  }
  return deps.store.listRequests();
}

/** Which folders the agent can open right now, according to TideCloak's role mappings. */
export async function agentFolderAccess(deps: Deps = defaultDeps()): Promise<{ roles: string[]; folders: FolderId[] }> {
  const agentId = await deps.admin.findUserId(deps.agentUsername);
  const roles = await deps.admin.getUserRealmRoles(agentId);
  const folders = (["bills", "medical", "id"] as FolderId[]).filter((id) => roles.includes(getFolder(id).agentRole));
  return { roles, folders };
}
