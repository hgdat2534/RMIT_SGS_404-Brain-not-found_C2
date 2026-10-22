// The server's admin client against the SIMULATED TideCloak - the same PROPOSER role as
// TidecloakAdmin, and deliberately the same surface: it can look users up, read role mappings and
// FILE a change request. There is no approve method here either, because a master-admin
// credential has none in a Tide multi-admin realm.

import type { AdminApi, ChangeRequestInfo, FiledChange } from "@/lib/server/tidecloakAdmin";
import { ChangeConflictError } from "@/lib/server/tidecloakAdmin";
import { SimHttpError, type SimRealm } from "./realm";

export class SimTidecloakAdmin implements AdminApi {
  constructor(private readonly realm: SimRealm) {}

  async findUserId(username: string): Promise<string> {
    const user = this.realm.findUserByName(username);
    if (!user) throw new Error(`TideCloak user '${username}' not found`);
    return user.id;
  }

  async getUserRealmRoles(userId: string): Promise<string[]> {
    const user = this.realm.findUserById(userId);
    if (!user) throw new Error(`TideCloak GET /users/${userId}/role-mappings/realm failed (HTTP 404)`);
    return user.realmRoles;
  }

  async proposeRealmRoleChange(userId: string, roleName: string, kind: "grant" | "revoke"): Promise<FiledChange> {
    try {
      const cr = this.realm.proposeRoleChange(userId, roleName, kind);
      return { changeRequestId: cr.id, applied: false };
    } catch (err) {
      if (err instanceof SimHttpError && err.status === 409) {
        throw new ChangeConflictError(
          "The agent account already has a pending change request. TideCloak allows one per user: approve or deny that one first.",
          err.extra.conflictingChangeRequestId as string | undefined,
        );
      }
      throw err;
    }
  }

  async listPendingChangeRequests(): Promise<(ChangeRequestInfo & { createdAt?: number | string })[]> {
    return this.realm.listChangeRequests("PENDING").map(toInfo);
  }

  async getChangeRequest(id: string): Promise<ChangeRequestInfo | null> {
    const cr = this.realm.getChangeRequest(id);
    return cr ? toInfo(cr) : null;
  }
}

function toInfo(cr: ReturnType<SimRealm["listChangeRequests"]>[number]): ChangeRequestInfo & { createdAt: number } {
  return {
    id: cr.id,
    status: cr.status,
    actionType: cr.actionType,
    entityId: cr.entityId,
    authorizationCount: cr.authorizationCount,
    threshold: cr.threshold,
    readyToCommit: false,
    createdAt: cr.createdAt,
  };
}
