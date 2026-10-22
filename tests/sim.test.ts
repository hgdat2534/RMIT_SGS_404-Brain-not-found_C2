import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { getFolder, OWNER_ROLE, requiredPolicies, type FolderId } from "@/lib/domain/folders";
import { fileAccessChange, agentFolderAccess, type Deps } from "@/lib/server/accessRequests";
import { Store } from "@/lib/server/store";
import { ChangeConflictError } from "@/lib/server/tidecloakAdmin";
import { SimTidecloakAdmin } from "@/lib/sim/adminClient";
import { NetworkRefusal, SimNetwork, type DokenClaims } from "@/lib/sim/network";
import { SimHttpError, SimRealm, SIM_VENDOR_ID } from "@/lib/sim/realm";

let network: SimNetwork;
let realm: SimRealm;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "errand-sim-"));
  network = new SimNetwork(dir);
  realm = new SimRealm(network, dir);
});

const claims = (token: string) => decodeJwt(token) as DokenClaims & { sub: string };
const signIn = async (username: string, jkt = `jkt-${username}`) => realm.signIn(username, jkt);
const doc = (folderId: FolderId, title: string) => ({ data: JSON.stringify({ title, body: "..." }), tags: [getFolder(folderId).recordId] });

/** Maya signs all six policies and encrypts one document per folder, as the owner page does. */
async function setUpVault() {
  const maya = claims((await signIn("maya")).access_token);
  const policies = network.signPolicies(maya, requiredPolicies(), SIM_VENDOR_ID, network.adminPolicy());
  const policy = (folderId: FolderId, role: string) => policies.find((p) => p.folderId === folderId && p.subjectRole === role)!.policyB64;
  const vault = Object.fromEntries(
    (["bills", "medical", "id"] as FolderId[]).map((f) => [f, network.encrypt(maya, [doc(f, `${f} doc`)], policy(f, OWNER_ROLE))]),
  ) as Record<FolderId, string[]>;
  return { maya, policy, vault };
}

/** What only Maya's enclave approval can do: phase 1, network signature, phase 2. */
function mayaApproves(maya: DokenClaims, changeRequestId: string) {
  const { requestModel } = realm.startApproval(maya, changeRequestId);
  return realm.commitApproval(maya, changeRequestId, network.approveChange(maya, requestModel));
}

describe("simulated TideCloak tokens", () => {
  it("are EdDSA tokens that verify against the adapter's JWKS, with roles and a DPoP binding", async () => {
    const tokens = await signIn("maya", "thumb-1");
    const config = realm.adapterConfig();
    const { payload } = await jwtVerify(tokens.access_token, createLocalJWKSet(config.jwk), { issuer: `${config["auth-server-url"]}/realms/${config.realm}` });
    expect(payload).toMatchObject({ azp: config.resource, preferred_username: "maya", cnf: { jkt: "thumb-1" } });
    expect((payload.realm_access as { roles: string[] }).roles).toContain(OWNER_ROLE);
    expect((payload.resource_access as Record<string, { roles: string[] }>)["realm-management"].roles).toContain("tide-realm-admin");
  });

  it("binds the refresh token to the DPoP key and rotates it", async () => {
    const tokens = await signIn("errand-agent", "agent-key");
    await expect(realm.refresh(tokens.refresh_token, "another-key")).rejects.toThrow(/different key/);
    const again = await signIn("errand-agent", "agent-key");
    const next = await realm.refresh(again.refresh_token, "agent-key");
    expect(claims(next.access_token).preferred_username).toBe("errand-agent");
    await expect(realm.refresh(again.refresh_token, "agent-key")).rejects.toThrow(/already used/);
  });
});

describe("simulated Tide network", () => {
  it("lets the owner decrypt her folders and refuses the agent without a folder role", async () => {
    const { maya, policy, vault } = await setUpVault();
    const tags = [getFolder("bills").recordId];
    expect(JSON.parse(network.decrypt(maya, [{ encrypted: vault.bills[0], tags }], policy("bills", OWNER_ROLE))[0]).title).toBe("bills doc");

    const agent = claims((await signIn("errand-agent")).access_token);
    // The server hands the agent the ciphertext AND the agent policy; the network still says no.
    expect(() => network.decrypt(agent, [{ encrypted: vault.bills[0], tags }], policy("bills", "agent.bills.read"))).toThrow(NetworkRefusal);
    try {
      network.decrypt(agent, [{ encrypted: vault.bills[0], tags }], policy("bills", OWNER_ROLE));
    } catch (err) {
      expect((err as NetworkRefusal).reason).toMatch(/role not found in doken: vault.owner/);
    }
  });

  it("refuses an item not tagged with the policy's record, and a read-only subject encrypting", async () => {
    const { maya, policy, vault } = await setUpVault();
    expect(() => network.decrypt(maya, [{ encrypted: vault.bills[0], tags: ["errand-folder-medical"] }], policy("bills", OWNER_ROLE))).toThrow(/Tags do not contain/);

    const agentTokens = await signIn("errand-agent");
    const agentId = realm.findUserByName("errand-agent")!.id;
    const cr = realm.proposeRoleChange(agentId, "agent.bills.read", "grant");
    mayaApproves(maya, cr.id);
    const agent = claims((await realm.refresh(agentTokens.refresh_token, "jkt-errand-agent")).access_token);
    expect(() => network.encrypt(agent, [doc("bills", "forged")], policy("bills", "agent.bills.read"))).toThrow(/may only read/);
  });

  it("lets Sam read Bills and nothing else, and Kim and Alex nothing at all", async () => {
    const { policy, vault } = await setUpVault();
    const item = (f: FolderId) => [{ encrypted: vault[f][0], tags: [getFolder(f).recordId] }];
    const sam = claims((await signIn("sam")).access_token);
    expect(JSON.parse(network.decrypt(sam, item("bills"), policy("bills", "household.bills.read"))[0]).title).toBe("bills doc");
    expect(() => network.decrypt(sam, item("medical"), policy("medical", OWNER_ROLE))).toThrow(/role not found in doken: vault.owner/);
    expect(() => network.encrypt(sam, [doc("bills", "x")], policy("bills", "household.bills.read"))).toThrow(/may only read/);
    for (const username of ["kim", "alex"]) {
      const who = claims((await signIn(username)).access_token);
      for (const f of ["bills", "medical", "id"] as FolderId[]) expect(() => network.decrypt(who, item(f), policy(f, OWNER_ROLE))).toThrow(NetworkRefusal);
    }
  });

  it("needs _tide_decryptor as well as the policy's role: a role alone opens nothing", async () => {
    const { policy, vault } = await setUpVault();
    const sam = claims((await signIn("sam")).access_token);
    const withoutDecryptor = { ...sam, realm_access: { roles: (sam.realm_access?.roles ?? []).filter((r) => r !== "_tide_decryptor") } };
    const item = [{ encrypted: vault.bills[0], tags: [getFolder("bills").recordId] }];
    expect(() => network.decrypt(withoutDecryptor, item, policy("bills", "household.bills.read"))).toThrow(/_tide_decryptor is required/);
  });

  it("rejects a policy that was altered after signing", async () => {
    const { maya, policy } = await setUpVault();
    const signed = JSON.parse(Buffer.from(policy("medical", "agent.medical.read"), "base64").toString());
    signed.payload = signed.payload.replace("agent.medical.read", "errand.agent");
    const forged = Buffer.from(JSON.stringify(signed)).toString("base64");
    expect(() => network.decrypt(maya, [{ encrypted: "SIMTIDE1.x", tags: ["errand-folder-medical"] }], forged)).toThrow(/does not verify/);
  });

  it("only signs policies for a tide-realm-admin", async () => {
    const agent = claims((await signIn("errand-agent")).access_token);
    expect(() => network.signPolicies(agent, requiredPolicies(), SIM_VENDOR_ID, network.adminPolicy())).toThrow(/tide-realm-admin/);
  });
});

describe("simulated IGA change requests", () => {
  let deps: Deps;
  beforeEach(() => {
    deps = { store: new Store(join(mkdtempSync(join(tmpdir(), "errand-")), "store.json")), admin: new SimTidecloakAdmin(realm), agentUsername: "errand-agent" };
  });

  it("the server can file a grant but it changes nothing until Maya signs it", async () => {
    const req = await fileAccessChange({ kind: "grant", folderId: "bills", requestedBy: "operator", requesterName: "platform-operator", reason: "r" }, deps);
    expect(req).toMatchObject({ status: "PENDING", role: "agent.bills.read" });
    expect((await agentFolderAccess(deps)).folders).toEqual([]);

    const second = await fileAccessChange({ kind: "grant", folderId: "medical", requestedBy: "agent", requesterName: "errand-agent", reason: "r" }, deps);
    expect(second.status).toBe("FAILED"); // one pending change per user, as in TideCloak
    await expect(deps.admin.proposeRealmRoleChange(realm.findUserByName("errand-agent")!.id, "agent.id.read", "grant")).rejects.toBeInstanceOf(ChangeConflictError);

    const maya = claims((await signIn("maya")).access_token);
    expect(mayaApproves(maya, req.changeRequestId!)).toMatchObject({ committed: true, status: "APPROVED" });
    expect((await agentFolderAccess(deps)).folders).toEqual(["bills"]);
  });

  it("the agent cannot approve its own request, nor get the network to sign one", async () => {
    const agentId = realm.findUserByName("errand-agent")!.id;
    const cr = realm.proposeRoleChange(agentId, "agent.medical.read", "grant");
    const agent = claims((await signIn("errand-agent")).access_token);
    expect(() => realm.startApproval(agent, cr.id)).toThrow(SimHttpError);
    const maya = claims((await signIn("maya")).access_token);
    const { requestModel } = realm.startApproval(maya, cr.id);
    expect(() => network.approveChange(agent, requestModel)).toThrow(/tide-realm-admin/);
    expect(() => realm.commitApproval(maya, cr.id, Buffer.from(JSON.stringify({ payload: "{}", signature: "AAAA" })).toString("base64"))).toThrow(/does not verify/);
  });

  it("an approval only commits the request it was signed for, presented by the admin it was signed for", async () => {
    const userId = realm.findUserByName("errand-agent")!.id;
    const first = realm.proposeRoleChange(userId, "agent.bills.read", "grant");
    const maya = claims((await signIn("maya")).access_token);
    const approvalForFirst = network.approveChange(maya, realm.startApproval(maya, first.id).requestModel);
    realm.deny(maya, first.id);

    const second = realm.proposeRoleChange(userId, "agent.medical.read", "grant");
    expect(() => realm.commitApproval(maya, second.id, approvalForFirst)).toThrow(/different change request/);
    const otherAdminSession = { ...maya, sub: "someone-else" };
    const approvalForSecond = network.approveChange(maya, realm.startApproval(maya, second.id).requestModel);
    expect(() => realm.commitApproval(otherAdminSession, second.id, approvalForSecond)).toThrow(/different admin/);
  });

  it("a revoke reaches the agent only when its token is refreshed", async () => {
    const { maya, policy, vault } = await setUpVault();
    const agentId = realm.findUserByName("errand-agent")!.id;
    mayaApproves(maya, realm.proposeRoleChange(agentId, "agent.bills.read", "grant").id);
    const tokens = await signIn("errand-agent");
    const before = claims(tokens.access_token);
    const item = [{ encrypted: vault.bills[0], tags: [getFolder("bills").recordId] }];
    expect(network.decrypt(before, item, policy("bills", "agent.bills.read"))).toHaveLength(1);

    mayaApproves(maya, realm.proposeRoleChange(agentId, "agent.bills.read", "revoke").id);
    expect(network.decrypt(before, item, policy("bills", "agent.bills.read"))).toHaveLength(1); // the old token still says so
    const after = claims((await realm.refresh(tokens.refresh_token, "jkt-errand-agent")).access_token);
    expect(() => network.decrypt(after, item, policy("bills", "agent.bills.read"))).toThrow(/role not found in doken/);
  });
});
