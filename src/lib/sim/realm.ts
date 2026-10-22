// SIMULATED TideCloak - the realm `errand`: users, roles, DPoP-bound tokens and IGA change requests.
//
// It plays the same part real TideCloak plays for this app:
//   - issues EdDSA-signed, sender-constrained (cnf.jkt) tokens that the app's withAuth verifies
//     exactly as it verifies real ones (same issuer/azp/expiry checks, same DPoP check)
//   - holds role mappings; the master-admin side (SimTidecloakAdmin) may only FILE a change
//   - commits a change only with an approval the network signed for a tide-realm-admin's session,
//     presented by that same admin (approvals.ts calls this from the owner's browser)
//
// What is not simulated: linking a Tide account. Sign-in is an account picker; in the real realm
// it is the user's own Tide account in the enclave, and no one else can sign in as them.

import { randomBytes, randomUUID, generateKeyPairSync, type JsonWebKey } from "crypto";
import { join } from "path";
import { importJWK, SignJWT } from "jose";
import { PEOPLE, type Person } from "@/lib/domain/people";
import { SIM_CLIENT_ID, SIM_REALM, SIM_TIDECLOAK_PATH, SIM_VENDOR_ID } from "./constants";
import { JsonFile, simDir } from "./jsonFile";
import { ADMIN_ROLE, getSimNetwork, rolesOf, type ChangeModel, type DokenClaims, type SimNetwork } from "./network";

export { SIM_CLIENT_ID, SIM_REALM, SIM_VENDOR_ID };
const ACCESS_TTL_S = 300;
const REFRESH_TTL_S = 1800;

/** An identifier only: the issuer the server expects. The browser uses its own origin. */
export function simAuthServerUrl(): string {
  return (process.env.SIM_TIDECLOAK_URL || `http://localhost:3000${SIM_TIDECLOAK_PATH}`).replace(/\/+$/, "");
}

export interface SimUser {
  id: string;
  username: string;
  displayName: string;
  vuid: string;
  realmRoles: string[];
  clientRoles: Record<string, string[]>;
}

export type SimChangeStatus = "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";

export interface SimChangeRequest {
  id: string;
  status: SimChangeStatus;
  actionType: "GRANT_ROLES" | "REVOKE_ROLES";
  entityId: string;
  role: string;
  kind: "grant" | "revoke";
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  authorizationCount: number;
  threshold: number;
}

interface RefreshGrant {
  token: string;
  userId: string;
  jkt: string;
  expiresAt: number;
}

interface RealmState {
  signingKey: { kid: string; privateJwk: JsonWebKey; publicJwk: JsonWebKey };
  users: SimUser[];
  changeRequests: SimChangeRequest[];
  refreshGrants: RefreshGrant[];
}

export interface TokenSet {
  access_token: string;
  id_token: string;
  refresh_token: string;
  token_type: "DPoP";
  expires_in: number;
}

/** A refusal with the HTTP status TideCloak would answer. */
export class SimHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SimHttpError";
  }
}

const vuid = () => randomBytes(32).toString("hex");

/** A realm user for each person in the cast, with their starting roles. Maya is the only admin. */
function seedUser(person: Person): SimUser {
  return {
    id: randomUUID(),
    username: person.username,
    displayName: `${person.name} (${person.title})`,
    vuid: vuid(),
    realmRoles: [...person.realmRoles],
    clientRoles: structuredClone(person.clientRoles),
  };
}

function freshRealm(): RealmState {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signingKey: { kid: randomUUID(), privateJwk: privateKey.export({ format: "jwk" }), publicJwk: publicKey.export({ format: "jwk" }) },
    users: PEOPLE.map(seedUser),
    changeRequests: [],
    refreshGrants: [],
  };
}

export class SimRealm {
  private readonly file: JsonFile<RealmState>;

  constructor(
    private readonly network: SimNetwork,
    dir: string = simDir(),
  ) {
    this.file = new JsonFile(join(dir, "realm.json"), freshRealm);
    // A realm saved by an older build keeps its users; anyone added to the cast since is created.
    this.file.update((s) => {
      for (const person of PEOPLE) if (!s.users.some((u) => u.username === person.username)) s.users.push(seedUser(person));
    });
  }

  issuer(): string {
    return `${simAuthServerUrl()}/realms/${SIM_REALM}`;
  }

  /** The adapter JSON, as `data/tidecloak.json` would hold it for the real realm. */
  adapterConfig() {
    const { kid, publicJwk } = this.file.read().signingKey;
    return {
      realm: SIM_REALM,
      "auth-server-url": simAuthServerUrl(),
      "ssl-required": "none",
      resource: SIM_CLIENT_ID,
      "public-client": true,
      "confidential-port": 0,
      jwk: { keys: [{ ...publicJwk, kid, alg: "EdDSA", use: "sig" }] },
      vendorId: SIM_VENDOR_ID,
    };
  }

  // --- users -------------------------------------------------------------------------------

  listUsers(): SimUser[] {
    return this.file.read().users;
  }

  findUserByName(username: string): SimUser | undefined {
    return this.listUsers().find((u) => u.username === username);
  }

  findUserById(id: string): SimUser | undefined {
    return this.listUsers().find((u) => u.id === id);
  }

  // --- tokens ------------------------------------------------------------------------------

  private async issue(user: SimUser, jkt: string): Promise<TokenSet> {
    const { kid, privateJwk } = this.file.read().signingKey;
    const key = await importJWK(privateJwk as Parameters<typeof importJWK>[0], "EdDSA");
    const now = Math.floor(Date.now() / 1000);
    const sid = randomUUID();
    const identity = { sub: user.id, preferred_username: user.username, name: user.displayName, vuid: user.vuid, sid };
    const resourceAccess = Object.fromEntries(Object.entries(user.clientRoles).map(([client, roles]) => [client, { roles }]));

    const access_token = await new SignJWT({
      ...identity,
      typ: "DPoP",
      azp: SIM_CLIENT_ID,
      realm_access: { roles: [...user.realmRoles, `default-roles-${SIM_REALM}`] },
      resource_access: resourceAccess,
      cnf: { jkt },
    })
      .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
      .setIssuer(this.issuer())
      .setAudience("account")
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TTL_S)
      .setJti(randomUUID())
      .sign(key);

    const id_token = await new SignJWT({ ...identity, typ: "ID", azp: SIM_CLIENT_ID })
      .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
      .setIssuer(this.issuer())
      .setAudience(SIM_CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TTL_S)
      .sign(key);

    const refresh_token = randomBytes(32).toString("base64url");
    this.file.update((s) => {
      s.refreshGrants = s.refreshGrants.filter((g) => g.expiresAt > Date.now());
      s.refreshGrants.push({ token: refresh_token, userId: user.id, jkt, expiresAt: Date.now() + REFRESH_TTL_S * 1000 });
    });
    return { access_token, id_token, refresh_token, token_type: "DPoP", expires_in: ACCESS_TTL_S };
  }

  /** Sign-in. `jkt` is the thumbprint of the DPoP key that proved possession on this request. */
  async signIn(username: string, jkt: string): Promise<TokenSet> {
    const user = this.findUserByName(username);
    if (!user) throw new SimHttpError(401, "invalid_grant: unknown user");
    return this.issue(user, jkt);
  }

  /**
   * New tokens carrying the user's CURRENT roles. The refresh token is bound to the DPoP key it was
   * issued to (RFC 9449 §5 for public clients) and rotates on every use.
   */
  async refresh(refreshToken: string, jkt: string): Promise<TokenSet> {
    const grant = this.file.update((s) => {
      const found = s.refreshGrants.find((g) => g.token === refreshToken);
      s.refreshGrants = s.refreshGrants.filter((g) => g.token !== refreshToken);
      return found;
    });
    if (!grant || grant.expiresAt < Date.now()) throw new SimHttpError(400, "invalid_grant: refresh token expired or already used");
    if (grant.jkt !== jkt) throw new SimHttpError(400, "invalid_dpop_proof: refresh token is bound to a different key");
    const user = this.findUserById(grant.userId);
    if (!user) throw new SimHttpError(400, "invalid_grant: user no longer exists");
    return this.issue(user, jkt);
  }

  logout(refreshToken: string): void {
    this.file.update((s) => {
      s.refreshGrants = s.refreshGrants.filter((g) => g.token !== refreshToken);
    });
  }

  // --- IGA change requests -----------------------------------------------------------------

  /**
   * File a realm-role change for a user. Never applied here. TideCloak keeps one pending change
   * per user, so a second one is a conflict until the first is resolved.
   */
  proposeRoleChange(userId: string, role: string, kind: "grant" | "revoke"): SimChangeRequest {
    return this.file.update((s) => {
      if (!s.users.some((u) => u.id === userId)) throw new SimHttpError(404, "User not found");
      const pending = s.changeRequests.find((c) => c.status === "PENDING" && c.entityId === userId);
      if (pending) throw new SimHttpError(409, "User already has a pending change request", { conflictingChangeRequestId: pending.id });
      const cr: SimChangeRequest = {
        id: randomUUID(),
        status: "PENDING",
        actionType: kind === "grant" ? "GRANT_ROLES" : "REVOKE_ROLES",
        entityId: userId,
        role,
        kind,
        createdAt: Date.now(),
        authorizationCount: 0,
        threshold: 1,
      };
      s.changeRequests.push(cr);
      return cr;
    });
  }

  getChangeRequest(id: string): SimChangeRequest | undefined {
    return this.file.read().changeRequests.find((c) => c.id === id);
  }

  listChangeRequests(status?: SimChangeStatus): SimChangeRequest[] {
    const all = this.file.read().changeRequests;
    return status ? all.filter((c) => c.status === status) : all;
  }

  private requireAdmin(claims: DokenClaims): void {
    if (!rolesOf(claims).includes(ADMIN_ROLE)) throw new SimHttpError(403, `Only a ${ADMIN_ROLE} may approve or deny change requests`);
  }

  private pending(id: string): SimChangeRequest {
    const cr = this.getChangeRequest(id);
    if (!cr) throw new SimHttpError(404, "Change request not found");
    if (cr.status !== "PENDING") throw new SimHttpError(409, `Change request is already ${cr.status}`);
    return cr;
  }

  /** Phase 1 of approve: what the admin must sign in the enclave. */
  startApproval(claims: DokenClaims, id: string): { mode: "needs-approval"; requestModel: string } {
    this.requireAdmin(claims);
    const cr = this.pending(id);
    const user = this.findUserById(cr.entityId);
    const model: ChangeModel = {
      changeRequestId: cr.id,
      realm: SIM_REALM,
      actionType: cr.actionType,
      userId: cr.entityId,
      username: user?.username ?? cr.entityId,
      role: cr.role,
      kind: cr.kind,
      issuedAt: new Date().toISOString(),
    };
    return { mode: "needs-approval", requestModel: Buffer.from(JSON.stringify(model)).toString("base64") };
  }

  /**
   * Phase 2: commit, if the network signed this exact change for THIS admin's session. A master-admin
   * credential, the agent, or a replayed approval for another request all fail here.
   */
  commitApproval(claims: DokenClaims, id: string, signedApprovalB64: string) {
    this.requireAdmin(claims);
    this.pending(id);
    let approval;
    try {
      approval = this.network.openApproval(signedApprovalB64);
    } catch (err) {
      throw new SimHttpError(403, `Approval rejected: ${err instanceof Error ? (err as { reason?: string }).reason ?? err.message : String(err)}`);
    }
    if (approval.model.changeRequestId !== id) throw new SimHttpError(403, "Approval is for a different change request");
    if (approval.approver.sub !== claims.sub) throw new SimHttpError(403, "Approval was signed for a different admin's session");

    return this.file.update((s) => {
      const cr = s.changeRequests.find((c) => c.id === id)!;
      const user = s.users.find((u) => u.id === cr.entityId);
      if (!user) throw new SimHttpError(404, "User not found");
      user.realmRoles = cr.kind === "grant" ? [...new Set([...user.realmRoles, cr.role])] : user.realmRoles.filter((r) => r !== cr.role);
      cr.status = "APPROVED";
      cr.authorizationCount = 1;
      cr.resolvedAt = Date.now();
      cr.resolvedBy = approval.approver.username;
      return { mode: "recorded", committed: true, status: cr.status, authCount: cr.authorizationCount, threshold: cr.threshold };
    });
  }

  deny(claims: DokenClaims, id: string): { status: SimChangeStatus } {
    this.requireAdmin(claims);
    this.pending(id);
    return this.file.update((s) => {
      const cr = s.changeRequests.find((c) => c.id === id)!;
      cr.status = "DENIED";
      cr.resolvedAt = Date.now();
      cr.resolvedBy = typeof claims.preferred_username === "string" ? claims.preferred_username : undefined;
      return { status: cr.status };
    });
  }
}

let _realm: SimRealm | null = null;

export function getSimRealm(): SimRealm {
  if (!_realm) _realm = new SimRealm(getSimNetwork());
  return _realm;
}
