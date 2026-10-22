// SIMULATED Tide network (the ORKs) - the party that decides who may decrypt.
//
// In the real system the key behind a folder never exists in one place: it is split across ORKs
// run by independent operators, and each ORK checks the caller's doken against the signed
// RelationshipAttestation:1 policy before contributing its share. Here one process holds the whole
// key (data/sim/network.json), so this simulates the CHECKS, not the threshold guarantee: whoever
// can read that file can decrypt everything. Keep it apart from the operator's store all the same,
// so the app code cannot reach it except through these calls.
//
// What is faithful:
//   - decrypt is refused unless the caller's own token carries the policy's subject role AND
//     _tide_decryptor (encrypt: _tide_encryptor)
//   - every item must be tagged with the policy's record id
//   - only a read-write subject may encrypt
//   - policies and change-request approvals are signed by the network key (the "VVK") and only
//     for a caller holding tide-realm-admin
//   - roles are read from the token, so a revoke bites at the next token refresh, not before

import { createCipheriv, createDecipheriv, generateKeyPairSync, hkdfSync, createPrivateKey, createPublicKey, randomBytes, sign, verify, type JsonWebKey } from "crypto";
import { join } from "path";
import { ADMIN_ROLE, DECRYPTOR_ROLE, ENCRYPTOR_ROLE, type PolicyAccess, type PolicySpec } from "@/lib/domain/folders";
import { JsonFile, simDir } from "./jsonFile";

export { ADMIN_ROLE };
const CIPHERTEXT_PREFIX = "SIMTIDE1.";

/** The claims the network reads from a caller's verified token. */
export interface DokenClaims {
  sub?: string;
  preferred_username?: unknown;
  vuid?: unknown;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] } | undefined>;
}

export interface SimPolicy {
  contract: "RelationshipAttestation:1";
  vendorId: string;
  subject: { type: "Role"; id: string };
  recordId: string;
  access: PolicyAccess;
  issuedAt: string;
  approvedBy: string;
}

interface AdminPolicy {
  contract: "AdminPolicy:1";
  role: typeof ADMIN_ROLE;
}

export interface ChangeModel {
  changeRequestId: string;
  realm: string;
  actionType: string;
  userId: string;
  username: string;
  role: string;
  kind: "grant" | "revoke";
  issuedAt: string;
}

export interface Approval {
  model: ChangeModel;
  approver: { sub: string; vuid: string; username: string };
  approvedAt: string;
}

/** Signed bytes: the exact JSON text that was signed, and the signature over it. */
interface Signed {
  payload: string;
  signature: string;
}

/**
 * The network said no. Shaped like the real SDK's refusal (TIDE-TIDEJS-NET-THRESHOLD_FAILURE with
 * the contract's message as the cause), so the app's error handling is the same in both modes.
 */
export class NetworkRefusal extends Error {
  static readonly SUMMARY = "Could not reach enough VVK ORKs";
  readonly code = "TIDE-TIDEJS-NET-THRESHOLD_FAILURE";
  constructor(readonly reason: string) {
    super(`${NetworkRefusal.SUMMARY}: ${reason}`);
    this.name = "NetworkRefusal";
  }
}

interface NetworkState {
  vvk: { privateJwk: JsonWebKey; publicJwk: JsonWebKey };
  masterSecret: string;
}

function freshState(): NetworkState {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    vvk: { privateJwk: privateKey.export({ format: "jwk" }), publicJwk: publicKey.export({ format: "jwk" }) },
    masterSecret: randomBytes(32).toString("base64"),
  };
}

const b64 = (buf: Buffer) => buf.toString("base64");
const encodeSigned = (s: Signed) => b64(Buffer.from(JSON.stringify(s)));

function decodeSigned(value: string, what: string): Signed {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf-8")) as Partial<Signed>;
    if (typeof parsed.payload === "string" && typeof parsed.signature === "string") return parsed as Signed;
  } catch {
    // fall through
  }
  throw new NetworkRefusal(`${what} is malformed`);
}

/** Every role in the token: realm roles plus every client's roles (tide-realm-admin is a client role). */
export function rolesOf(claims: DokenClaims): string[] {
  const roles = [...(claims.realm_access?.roles ?? [])];
  for (const client of Object.values(claims.resource_access ?? {})) roles.push(...(client?.roles ?? []));
  return roles;
}

function who(claims: DokenClaims): string {
  return typeof claims.preferred_username === "string" ? claims.preferred_username : String(claims.sub ?? "unknown");
}

export class SimNetwork {
  private readonly file: JsonFile<NetworkState>;

  constructor(dir: string = simDir()) {
    this.file = new JsonFile(join(dir, "network.json"), freshState);
  }

  /** The network's public key. TideCloak uses it to check approvals came from the enclave. */
  publicJwk(): JsonWebKey {
    return this.file.read().vvk.publicJwk;
  }

  // --- signing -----------------------------------------------------------------------------

  private sign(body: unknown): string {
    const payload = JSON.stringify(body);
    const key = createPrivateKey({ key: this.file.read().vvk.privateJwk, format: "jwk" });
    return encodeSigned({ payload, signature: b64(sign(null, Buffer.from(payload), key)) });
  }

  private open<T>(value: string, what: string): T {
    const signed = decodeSigned(value, what);
    const key = createPublicKey({ key: this.publicJwk(), format: "jwk" });
    if (!verify(null, Buffer.from(signed.payload), key, Buffer.from(signed.signature, "base64"))) {
      throw new NetworkRefusal(`${what} signature does not verify against the VVK`);
    }
    return JSON.parse(signed.payload) as T;
  }

  /** The realm's tide-realm-admin policy, which authorises signing other policies. */
  adminPolicy(): string {
    return this.sign({ contract: "AdminPolicy:1", role: ADMIN_ROLE } satisfies AdminPolicy);
  }

  private requireAdmin(claims: DokenClaims, action: string): void {
    if (!rolesOf(claims).includes(ADMIN_ROLE)) {
      throw new NetworkRefusal(`role not found in doken: ${ADMIN_ROLE} is required to ${action}`);
    }
  }

  /** Sign folder policies after the admin approved them in the enclave. */
  signPolicies(claims: DokenClaims, specs: PolicySpec[], vendorId: string, adminPolicyB64: string): (PolicySpec & { policyB64: string })[] {
    this.requireAdmin(claims, "sign policies");
    const admin = this.open<AdminPolicy>(adminPolicyB64, "Admin policy");
    if (admin.contract !== "AdminPolicy:1" || admin.role !== ADMIN_ROLE) throw new NetworkRefusal("Admin policy is not the tide-realm-admin policy");
    const approvedBy = String(claims.vuid ?? claims.sub ?? "");
    const issuedAt = new Date().toISOString();
    return specs.map((spec) => {
      const policy: SimPolicy = {
        contract: "RelationshipAttestation:1",
        vendorId,
        subject: { type: "Role", id: spec.subjectRole },
        recordId: spec.recordId,
        access: spec.access,
        issuedAt,
        approvedBy,
      };
      return { ...spec, policyB64: this.sign(policy) };
    });
  }

  /** Sign an IGA change request for TideCloak to commit. Only a realm admin's session can. */
  approveChange(claims: DokenClaims, requestModelB64: string): string {
    this.requireAdmin(claims, "approve a change request");
    let model: ChangeModel;
    try {
      model = JSON.parse(Buffer.from(requestModelB64, "base64").toString("utf-8")) as ChangeModel;
    } catch {
      throw new NetworkRefusal("Change request model is malformed");
    }
    if (typeof model.changeRequestId !== "string") throw new NetworkRefusal("Change request model has no id");
    const approval: Approval = {
      model,
      approver: { sub: String(claims.sub ?? ""), vuid: String(claims.vuid ?? ""), username: who(claims) },
      approvedAt: new Date().toISOString(),
    };
    return this.sign(approval);
  }

  /** Check an approval came from the network (TideCloak calls this before committing). */
  openApproval(signedB64: string): Approval {
    return this.open<Approval>(signedB64, "Approval");
  }

  // --- encryption --------------------------------------------------------------------------

  /** The RelationshipAttestation:1 checks every ORK runs. Throws NetworkRefusal. */
  private check(claims: DokenClaims, policyB64: string, tagsPerItem: string[][], op: "encrypt" | "decrypt"): SimPolicy {
    const policy = this.open<SimPolicy>(policyB64, "Policy");
    if (policy.contract !== "RelationshipAttestation:1" || policy.subject?.type !== "Role") {
      throw new NetworkRefusal(`Policy contract ${String(policy.contract)} is not supported`);
    }
    // Both halves, as the real contract wants them: the policy's subject role AND the realm role for
    // the operation. A role alone opens nothing; a policy alone opens nothing.
    const roles = rolesOf(claims);
    if (!roles.includes(policy.subject.id)) {
      throw new NetworkRefusal(`role not found in doken: ${policy.subject.id} (caller ${who(claims)})`);
    }
    if (op === "encrypt" && policy.access !== "read-write") {
      throw new NetworkRefusal(`role not found for this encryption request: ${policy.subject.id} may only read`);
    }
    const opRole = op === "encrypt" ? ENCRYPTOR_ROLE : DECRYPTOR_ROLE;
    if (!roles.includes(opRole)) {
      throw new NetworkRefusal(`role not found in doken: ${opRole} is required to ${op} (caller ${who(claims)})`);
    }
    if (tagsPerItem.some((tags) => !tags.includes(policy.recordId))) {
      throw new NetworkRefusal(`Tags do not contain assignmentId ${policy.recordId}`);
    }
    return policy;
  }

  private recordKey(vendorId: string, recordId: string): Buffer {
    const secret = Buffer.from(this.file.read().masterSecret, "base64");
    return Buffer.from(hkdfSync("sha256", secret, vendorId, `record:${recordId}`, 32));
  }

  encrypt(claims: DokenClaims, items: { data: string; tags: string[] }[], policyB64: string): string[] {
    const policy = this.check(claims, policyB64, items.map((i) => i.tags), "encrypt");
    const key = this.recordKey(policy.vendorId, policy.recordId);
    return items.map((item) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(policy.recordId));
      const body = Buffer.concat([cipher.update(item.data, "utf-8"), cipher.final()]);
      return CIPHERTEXT_PREFIX + b64(Buffer.concat([iv, body, cipher.getAuthTag()]));
    });
  }

  decrypt(claims: DokenClaims, items: { encrypted: string; tags: string[] }[], policyB64: string): string[] {
    const policy = this.check(claims, policyB64, items.map((i) => i.tags), "decrypt");
    const key = this.recordKey(policy.vendorId, policy.recordId);
    return items.map((item) => {
      if (!item.encrypted.startsWith(CIPHERTEXT_PREFIX)) throw new NetworkRefusal("Not a ciphertext from this network");
      const raw = Buffer.from(item.encrypted.slice(CIPHERTEXT_PREFIX.length), "base64");
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAAD(Buffer.from(policy.recordId));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf-8");
      } catch {
        throw new NetworkRefusal(`Ciphertext does not belong to record ${policy.recordId}`);
      }
    });
  }
}

let _network: SimNetwork | null = null;

export function getSimNetwork(): SimNetwork {
  if (!_network) _network = new SimNetwork();
  return _network;
}
