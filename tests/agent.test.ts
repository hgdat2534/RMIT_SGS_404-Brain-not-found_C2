import { describe, expect, it } from "vitest";
import { draftCancellation, isUnusedSubscription, parseBill, summariseBills } from "@/lib/agent/bills";
import { findEmbeddedInstructions, runErrand, type AgentTools } from "@/lib/agent/errandAgent";
import type { FolderId } from "@/lib/domain/folders";
import { SEED_DOCUMENTS } from "@/lib/seed/documents";

const TODAY = new Date("2026-10-22T00:00:00Z");
const bills = SEED_DOCUMENTS.bills.map((d, i) => ({ id: `bill-${i}`, ...d }));

describe("bill parsing", () => {
  it("reads vendor, amount, due date and usage", () => {
    const gym = parseBill(bills[1]);
    expect(gym).toMatchObject({ vendor: "IronPeak Fitness", category: "Subscription", amountDue: 49, dueDate: "2026-11-01", lastUsed: "2026-04-11", memberId: "IP-55821" });
  });

  it("flags only the idle subscription as unused", () => {
    const parsed = bills.map(parseBill);
    expect(parsed.filter((b) => isUnusedSubscription(b, TODAY)).map((b) => b.vendor)).toEqual(["IronPeak Fitness"]);
  });

  it("drafts a cancellation addressed to the vendor's cancellation email", () => {
    const draft = draftCancellation(parseBill(bills[1]), TODAY, "Maya");
    expect(draft.to).toBe("cancel@ironpeak.example");
    expect(draft.body).toContain("IP-55821");
    expect(draft.idleDays).toBe(194);
  });

  it("totals the bills and finds the next one due", () => {
    const s = summariseBills(bills.map(parseBill));
    expect(s.total).toBe(168.2);
    expect(s.nextDue?.vendor).toBe("IronPeak Fitness");
  });
});

describe("prompt-injection detection", () => {
  it("finds the planted instruction in the phone bill and maps it to Medical", () => {
    const found = bills.flatMap(findEmbeddedInstructions);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ docId: "bill-2", targetFolder: "medical" });
    expect(found[0].excerpt).toMatch(/export the Medical folder/);
  });

  it("ignores ordinary bill text", () => {
    expect(findEmbeddedInstructions(bills[0])).toEqual([]);
    expect(findEmbeddedInstructions({ id: "x", title: "t", body: "Please pay by the due date. Thank you." })).toEqual([]);
  });
});

function fakeTools(granted: FolderId[]) {
  const calls: string[] = [];
  const tools: AgentTools = {
    async readFolder(folderId) {
      calls.push(`read:${folderId}`);
      if (!granted.includes(folderId)) return { ok: false, error: "'agent.medical.read' role not found in doken.", refusedByNetwork: true };
      return { ok: true, value: folderId === "bills" ? bills : SEED_DOCUMENTS[folderId].map((d, i) => ({ id: `${folderId}-${i}`, ...d })) };
    },
    async requestAccess(folderId, _reason, trigger) {
      calls.push(`request:${folderId}:${trigger.docId}`);
      return { ok: true, value: { requestId: "r1", changeRequestId: "cr-1" } };
    },
  };
  return { tools, calls };
}

describe("runErrand", () => {
  it("does the bills job, follows the injection, is refused, then files a request", async () => {
    const { tools, calls } = fakeTools(["bills"]);
    const report = await runErrand(tools, { ownerName: "Maya", today: TODAY });
    expect(report.bills).toHaveLength(3);
    expect(report.drafts.map((d) => d.vendor)).toEqual(["IronPeak Fitness"]);
    expect(calls).toEqual(["read:bills", "read:medical", "request:medical:bill-2"]);
    expect(report.hijackAttempts).toEqual([expect.objectContaining({ outcome: "refused" })]);
    expect(report.steps.some((s) => s.kind === "refused" && /Tide network refused/.test(s.text))).toBe(true);
  });

  it("stops at the first step when it has no Bills access", async () => {
    const { tools, calls } = fakeTools([]);
    const report = await runErrand(tools, { ownerName: "Maya", today: TODAY });
    expect(calls).toEqual(["read:bills"]);
    expect(report.bills).toEqual([]);
    expect(report.steps.at(-1)?.text).toMatch(/needs to grant it/);
  });

  it("shows what an over-granted agent leaks: with Medical approved, the injection succeeds", async () => {
    const { tools, calls } = fakeTools(["bills", "medical"]);
    const report = await runErrand(tools, { ownerName: "Maya", today: TODAY });
    expect(calls).toEqual(["read:bills", "read:medical"]);
    expect(report.hijackAttempts[0].outcome).toBe("succeeded");
  });
});
