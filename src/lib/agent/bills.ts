// Reading bills: the "useful work" half of the agent. Pure functions, no I/O.

export interface AgentDocument {
  id: string;
  title: string;
  body: string;
}

export interface Bill {
  docId: string;
  title: string;
  vendor: string;
  category: string;
  amountDue: number;
  dueDate: string | null;
  billing: string | null;
  lastUsed: string | null;
  memberId: string | null;
  cancellation: string | null;
}

export interface CancellationDraft {
  docId: string;
  vendor: string;
  to: string | null;
  subject: string;
  body: string;
  monthlySaving: number;
  idleDays: number;
}

const UNUSED_AFTER_DAYS = 60;

function field(body: string, name: string): string | null {
  const match = body.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

export function parseBill(doc: AgentDocument): Bill {
  const amount = field(doc.body, "Amount due");
  return {
    docId: doc.id,
    title: doc.title,
    vendor: field(doc.body, "Vendor") ?? doc.title,
    category: field(doc.body, "Category") ?? "Other",
    amountDue: amount ? Number(amount.replace(/[^0-9.]/g, "")) || 0 : 0,
    dueDate: field(doc.body, "Due date"),
    billing: field(doc.body, "Billing"),
    lastUsed: field(doc.body, "Last check-in") ?? field(doc.body, "Last used"),
    memberId: field(doc.body, "Member ID") ?? field(doc.body, "Account"),
    cancellation: field(doc.body, "Cancellation"),
  };
}

export function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  return Math.floor((to.getTime() - from) / 86_400_000);
}

export function isUnusedSubscription(bill: Bill, today: Date): boolean {
  if (!/subscription/i.test(bill.category) || !bill.lastUsed) return false;
  return daysBetween(bill.lastUsed, today) > UNUSED_AFTER_DAYS;
}

export function draftCancellation(bill: Bill, today: Date, ownerName: string): CancellationDraft {
  const email = bill.cancellation?.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? null;
  const idleDays = bill.lastUsed ? daysBetween(bill.lastUsed, today) : 0;
  return {
    docId: bill.docId,
    vendor: bill.vendor,
    to: email,
    subject: `Cancel membership ${bill.memberId ?? ""}`.trim(),
    body: [
      `Hello ${bill.vendor},`,
      "",
      `Please cancel my membership${bill.memberId ? ` (${bill.memberId})` : ""} at the end of the current notice period.`,
      "Please confirm the final billing date in writing.",
      "",
      "Thank you,",
      ownerName,
    ].join("\n"),
    monthlySaving: bill.amountDue,
    idleDays,
  };
}

export function summariseBills(bills: Bill[]): { total: number; nextDue: Bill | null; lines: string[] } {
  const total = Math.round(bills.reduce((sum, b) => sum + b.amountDue, 0) * 100) / 100;
  const dated = bills.filter((b) => b.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const lines = bills.map((b) => `${b.vendor}: $${b.amountDue.toFixed(2)} due ${b.dueDate ?? "(no date)"} [${b.category}]`);
  return { total, nextDue: dated[0] ?? null, lines };
}
