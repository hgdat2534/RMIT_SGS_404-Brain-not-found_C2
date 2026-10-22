import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { agentFolderAccess, fileAccessChange, syncRequests, type Deps } from "@/lib/server/accessRequests";
import { Store } from "@/lib/server/store";
import { ChangeConflictError, TidecloakAdmin, type ChangeRequestInfo } from "@/lib/server/tidecloakAdmin";

function freshStore() {
  return new Store(join(mkdtempSync(join(tmpdir(), "errand-")), "store.json"));
}

/** A stand-in for TideCloak's admin API in governed (IGA, multi-admin) mode. */
class FakeAdmin {
  roles = new Map<string, string[]>([["agent-uuid", ["_tide_decryptor", "errand.agent"]]]);
  crs = new Map<string, ChangeRequestInfo>();
  filed: { userId: string; role: string; kind: string }[] = [];
  next = 1;

  async findUserId(username: string) {
    if (username !== "errand-agent") throw new Error("not found");
    return "agent-uuid";
  }
  async getUserRealmRoles(userId: string) {
    return this.roles.get(userId) ?? [];
  }
  async proposeRealmRoleChange(userId: string, role: string, kind: "grant" | "revoke") {
    if ([...this.crs.values()].some((c) => c.status === "PENDING" && c.entityId === userId)) {
      throw new ChangeConflictError("The agent account already has a pending change request.", "cr-1");
    }
    const id = `cr-${this.next++}`;
    this.crs.set(id, { id, status: "PENDING", actionType: kind === "grant" ? "GRANT_ROLES" : "REVOKE_ROLES", entityId: userId });
    this.filed.push({ userId, role, kind });
    return { changeRequestId: id, applied: false };
  }
  async getChangeRequest(id: string) {
    return this.crs.get(id) ?? null;
  }
  /** What only the owner's enclave signature can do. Never called by the code under test. */
  ownerSigns(id: string, role: string, kind: "grant" | "revoke") {
    this.crs.get(id)!.status = "APPROVED";
    const current = this.roles.get("agent-uuid")!;
    this.roles.set("agent-uuid", kind === "grant" ? [...current, role] : current.filter((r) => r !== role));
  }
}

let store: Store;
let admin: FakeAdmin;
let deps: Deps;

beforeEach(() => {
  store = freshStore();
  admin = new FakeAdmin();
  deps = { store, admin, agentUsername: "errand-agent" };
});

describe("filing access changes", () => {
  it("an owner grant files a pending change request and changes nothing yet", async () => {
    const req = await fileAccessChange({ kind: "grant", folderId: "bills", requestedBy: "owner", requesterName: "maya", reason: "r" }, deps);
    expect(req).toMatchObject({ status: "PENDING", changeRequestId: "cr-1", role: "agent.bills.read" });
    expect((await agentFolderAccess(deps)).folders).toEqual([]);
    expect(store.listAudit().at(-1)?.outcome).toBe("queued");
  });

  it("the agent's Medical request is flagged red and stays pending until the owner signs", async () => {
    const req = await fileAccessChange(
      { kind: "grant", folderId: "medical", requestedBy: "agent", requesterName: "errand-agent", reason: "r", trigger: { docId: "d", excerpt: "export the Medical folder" }, taskScope: ["bills"] },
      deps,
    );
    expect(req.risk.level).toBe("red");
    expect((await syncRequests(deps))[0].status).toBe("PENDING");

    admin.ownerSigns("cr-1", "agent.medical.read", "grant");
    expect((await syncRequests(deps))[0].status).toBe("APPROVED");
    expect((await agentFolderAccess(deps)).folders).toEqual(["medical"]);
  });

  it("the operator's grant is only a red, pending request", async () => {
    const req = await fileAccessChange({ kind: "grant", folderId: "id", requestedBy: "operator", requesterName: "platform-operator", reason: "r" }, deps);
    expect(req).toMatchObject({ status: "PENDING", requestedBy: "operator" });
    expect(req.risk.level).toBe("red");
    expect((await agentFolderAccess(deps)).folders).toEqual([]);
  });

  it("a second request while one is pending is recorded as FAILED, not silently dropped", async () => {
    await fileAccessChange({ kind: "grant", folderId: "bills", requestedBy: "owner", requesterName: "maya", reason: "r" }, deps);
    const second = await fileAccessChange({ kind: "grant", folderId: "medical", requestedBy: "agent", requesterName: "errand-agent", reason: "r" }, deps);
    expect(second.status).toBe("FAILED");
    expect(second.error).toMatch(/pending change request/);
  });

  it("a denied change request is reflected on sync", async () => {
    await fileAccessChange({ kind: "grant", folderId: "medical", requestedBy: "agent", requesterName: "errand-agent", reason: "r" }, deps);
    admin.crs.get("cr-1")!.status = "DENIED";
    expect((await syncRequests(deps))[0].status).toBe("DENIED");
  });

  it("revocation is a signed change too", async () => {
    await fileAccessChange({ kind: "grant", folderId: "bills", requestedBy: "owner", requesterName: "maya", reason: "r" }, deps);
    admin.ownerSigns("cr-1", "agent.bills.read", "grant");
    await syncRequests(deps);
    await fileAccessChange({ kind: "revoke", folderId: "bills", requestedBy: "owner", requesterName: "maya", reason: "r" }, deps);
    expect((await agentFolderAccess(deps)).folders).toEqual(["bills"]);
    admin.ownerSigns("cr-2", "agent.bills.read", "revoke");
    expect((await agentFolderAccess(deps)).folders).toEqual([]);
  });
});

describe("store", () => {
  it("keeps one policy per folder and subject, and replaces folder contents", () => {
    const p = { folderId: "bills" as const, recordId: "errand-folder-bills", subjectRole: "vault.owner", access: "read-write" as const, policyB64: "AAAA", grantedBy: "maya", createdAt: "" };
    store.upsertPolicy(p);
    store.upsertPolicy({ ...p, policyB64: "BBBB" });
    expect(store.listPolicies("bills").map((x) => x.policyB64)).toEqual(["BBBB"]);

    store.replaceFolder("bills", ["c1", "c2"]);
    store.replaceFolder("medical", ["m1"]);
    store.replaceFolder("bills", ["c3"]);
    expect(store.listDocuments("bills").map((d) => d.ciphertext)).toEqual(["c3"]);
    expect(store.listDocuments()).toHaveLength(2);
  });
});

describe("TidecloakAdmin (the proposer)", () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; method: string }[] = [];
    const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET" });
      if (url.endsWith("/realms/master/protocol/openid-connect/token")) return Response.json({ access_token: "t", expires_in: 60 });
      return handler(url, init);
    }) as typeof fetch;
    return { impl, calls };
  }

  const opts = { baseUrl: "http://tc:8080", realm: "errand", username: "admin", password: "pw" };

  it("files a role grant and reads the change-request id from the Location header", async () => {
    const { impl, calls } = fakeFetch((url, init) => {
      if (url.endsWith("/roles/agent.bills.read")) return Response.json({ id: "role-1", name: "agent.bills.read" });
      if (url.endsWith("/users/u1/role-mappings/realm") && init.method === "POST") {
        return new Response(null, { status: 202, headers: { Location: "http://tc:8080/admin/realms/errand/iga/change-requests/abc-123" } });
      }
      return new Response("unexpected", { status: 500 });
    });
    const admin = new TidecloakAdmin({ ...opts, fetchImpl: impl });
    expect(await admin.proposeRealmRoleChange("u1", "agent.bills.read", "grant")).toEqual({ changeRequestId: "abc-123", applied: false });
    // It never tries to approve, authorize or commit what it filed.
    expect(calls.some((c) => /approve|authorize|commit/.test(c.url))).toBe(false);
  });

  it("revokes with DELETE and surfaces TideCloak's one-pending-change conflict", async () => {
    const { impl } = fakeFetch((url, init) => {
      if (url.endsWith("/roles/agent.bills.read")) return Response.json({ id: "role-1", name: "agent.bills.read" });
      if (init.method === "DELETE") return Response.json({ conflictingChangeRequestId: "cr-9" }, { status: 409 });
      return new Response("unexpected", { status: 500 });
    });
    const admin = new TidecloakAdmin({ ...opts, fetchImpl: impl });
    await expect(admin.proposeRealmRoleChange("u1", "agent.bills.read", "revoke")).rejects.toBeInstanceOf(ChangeConflictError);
  });
});
