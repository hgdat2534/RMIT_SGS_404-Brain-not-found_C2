"use client";
import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { Badge, RequireRole } from "@/components/Shell";
import { explainTideError, useApi } from "@/lib/tide/client";
import { approveChangeRequests, denyChangeRequest, signFolderPolicies } from "@/lib/tide/governance";
import { decryptMany, encryptMany } from "@/lib/tide/vaultCrypto";
import { SEED_DOCS } from "@/lib/errand/seed";
import { FOLDERS, POLICY_PLAN, ROLES, type AccessRequest, type AuditEvent, type StoredDoc, type StoredPolicy } from "@/lib/errand/model";

interface PendingCR {
  id: string;
  actionType: string;
  entityType: string;
  rows?: unknown;
  involvesAgent: boolean;
  origin: string;
  flagged: boolean;
  authorizationCount?: number;
  threshold?: number;
}

type Msg = { tone: "ok" | "bad" | "warn" | "info"; text: string; detail?: string } | null;

export default function VaultPage() {
  return (
    <RequireRole role={ROLES.owner} who="Maya (the vault owner)">
      <Vault />
    </RequireRole>
  );
}

function Vault() {
  const { api, tcAdmin } = useApi();
  const { getVendorId } = useTideCloak();
  const [policies, setPolicies] = useState<StoredPolicy[]>([]);
  const [docs, setDocs] = useState<StoredDoc[]>([]);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [agentRoles, setAgentRoles] = useState<string[] | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [pending, setPending] = useState<PendingCR[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [igaError, setIgaError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, d, r, a] = await Promise.all([
      api("/api/policies"),
      api("/api/docs"),
      api("/api/requests"),
      api("/api/audit"),
    ]);
    setPolicies(p.policies);
    setDocs(d.docs);
    setRequests(r.requests);
    setEvents(a.events);
    try {
      const [g, c] = await Promise.all([api("/api/grants"), api("/api/iga/pending")]);
      setAgentRoles(g.roles);
      setPending(c.changes);
      setIgaError(null);
    } catch (e) {
      setIgaError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    refresh().catch((e) => setMsg({ tone: "bad", text: e.message }));
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      const t = explainTideError(e);
      setMsg({ tone: "bad", text: `${label}: ${t.headline}`, detail: t.detail });
    } finally {
      setBusy(null);
      refresh().catch(() => {});
    }
  };

  const ownerPolicy = (folder: string) => policies.find((p) => p.role === ROLES.owner && p.folder === folder);
  const signedKeys = new Set(policies.map((p) => p.key));
  // The owner only sees owner policies through the filtered endpoint; count via /api/status instead.
  const [planStatus, setPlanStatus] = useState<{ policiesSigned: number; policiesPlanned: number; docs: number } | null>(null);
  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setPlanStatus).catch(() => {});
  }, [policies, docs]);

  // ---------------- Setup ----------------
  const signPolicies = () =>
    run("Sign folder policies", async () => {
      const signed = await signFolderPolicies(getVendorId(), tcAdmin, POLICY_PLAN, (t) => setMsg({ tone: "info", text: t }));
      await api("/api/policies", { method: "POST", body: JSON.stringify({ policies: signed }) });
      setMsg({ tone: "ok", text: `Signed ${signed.length} policies. Each one names a ROLE and a folder; the Tide network enforces it on every decrypt.` });
    });

  const seedDocs = () =>
    run("Encrypt synthetic documents", async () => {
      const items: { folder: string; title: string; ciphertext: string }[] = [];
      for (const f of FOLDERS) {
        const pol = ownerPolicy(f.id);
        if (!pol) throw new Error(`Sign the policies first (missing owner policy for ${f.label})`);
        const seed = SEED_DOCS.filter((d) => d.folder === f.id);
        const cts = await encryptMany(seed.map((d) => d.body), f.recordId, pol.policyB64);
        seed.forEach((d, i) => items.push({ folder: f.id, title: d.title, ciphertext: cts[i] }));
      }
      await api("/api/docs", { method: "POST", body: JSON.stringify({ items, replace: true }) });
      setMsg({ tone: "ok", text: `Encrypted ${items.length} documents in this browser. The server received ciphertext only.` });
    });

  const decryptFolder = (folderId: string) =>
    run(`Decrypt ${folderId}`, async () => {
      const f = FOLDERS.find((x) => x.id === folderId)!;
      const pol = ownerPolicy(f.id);
      if (!pol) throw new Error("No owner policy for this folder yet");
      const fd = docs.filter((d) => d.folder === f.id);
      const out = await decryptMany(fd.map((d) => d.ciphertext), f.recordId, pol.policyB64);
      setPlain((p) => ({ ...p, ...Object.fromEntries(fd.map((d, i) => [d.id, out[i]])) }));
    });

  // ---------------- Grants (file a change request, then sign it here) ----------------
  const fileAndSign = async (op: "grant" | "revoke", role: string) => {
    const filed = await api("/api/grants", { method: "POST", body: JSON.stringify({ op, role }) });
    if (!filed.changeRequestId) {
      if (filed.status >= 200 && filed.status < 300) return { committed: true, id: "" };
      throw new Error(`TideCloak did not file a change request (HTTP ${filed.status}): ${JSON.stringify(filed.body)}`);
    }
    setMsg({ tone: "info", text: `Change request ${filed.changeRequestId} filed. Approve it in the Tide window.` });
    const [res] = await approveChangeRequests([filed.changeRequestId], tcAdmin);
    if (!res?.ok) throw new Error(res?.message ?? "approval failed");
    return { committed: !!res.committed, id: filed.changeRequestId };
  };

  const grantBills = () =>
    run("Grant Errand the Bills role", async () => {
      const r = await fileAndSign("grant", ROLES.agentBills);
      setMsg({ tone: "ok", text: `Signed. Errand now holds ${ROLES.agentBills}${r.committed ? "" : " once quorum is met"}. It takes effect on the agent's next session refresh.` });
    });

  const revokeAll = () =>
    run("Revoke Errand", async () => {
      const held = (agentRoles ?? []).filter((r) => r === ROLES.agentBills || r === ROLES.agentMedical);
      if (!held.length) throw new Error("Errand holds no agent.* role right now");
      for (const role of held) await fileAndSign("revoke", role);
      setMsg({ tone: "ok", text: `Revoked ${held.join(", ")}. Errand's next unlock fails once its session refreshes.` });
    });

  // ---------------- Approvals queue ----------------
  const approveAgentRequest = (r: AccessRequest) =>
    run(`Approve ${r.id}`, async () => {
      const res = await fileAndSign("grant", r.role);
      await api("/api/requests", { method: "PATCH", body: JSON.stringify({ id: r.id, status: "approved", changeRequestId: res.id }) });
      setMsg({ tone: "warn", text: `You signed ${r.role} for Errand. Only you could.` });
    });

  const denyRequest = (r: AccessRequest) =>
    run(`Deny ${r.id}`, async () => {
      if (r.changeRequestId && pending.some((c) => c.id === r.changeRequestId)) {
        await denyChangeRequest(r.changeRequestId, tcAdmin, "Denied by Maya in Errand");
      }
      await api("/api/requests", { method: "PATCH", body: JSON.stringify({ id: r.id, status: "denied" }) });
      setMsg({ tone: "ok", text: "Denied. Nothing changed in TideCloak or on the Tide network." });
    });

  const signCR = (cr: PendingCR) =>
    run(`Sign ${cr.id}`, async () => {
      const [res] = await approveChangeRequests([cr.id], tcAdmin);
      if (!res?.ok) throw new Error(res?.message ?? "approval failed");
      const linked = requests.find((r) => r.changeRequestId === cr.id && r.status === "pending");
      if (linked) await api("/api/requests", { method: "PATCH", body: JSON.stringify({ id: linked.id, status: "approved" }) });
      setMsg({ tone: "warn", text: `Signed ${cr.actionType}: ${res.message}` });
    });

  const denyCR = (cr: PendingCR) =>
    run(`Deny ${cr.id}`, async () => {
      await denyChangeRequest(cr.id, tcAdmin, "Denied by Maya in Errand");
      const linked = requests.find((r) => r.changeRequestId === cr.id && r.status === "pending");
      if (linked) await api("/api/requests", { method: "PATCH", body: JSON.stringify({ id: linked.id, status: "denied" }) });
      setMsg({ tone: "ok", text: "Denied." });
    });

  const openRequests = requests.filter((r) => r.status === "pending");
  const linkedCrIds = new Set(requests.map((r) => r.changeRequestId).filter(Boolean));
  const looseCRs = pending.filter((c) => !openRequests.some((r) => r.changeRequestId === c.id));
  const allSigned = (planStatus?.policiesSigned ?? 0) >= POLICY_PLAN.length;

  return (
    <div className="page stack">
      <div>
        <h1>Maya&apos;s vault</h1>
        <p className="lede">
          Each folder is encrypted in this browser under a policy the Tide network enforces. Errand, the server and
          the server&apos;s admin each hold less than it takes to open a folder. Only your signature in the Tide
          window changes who can.
        </p>
      </div>

      {msg && (
        <div className={`notice ${msg.tone}`}>
          <b>{msg.text}</b>
          {msg.detail && <pre className="small" style={{ marginTop: 6 }}>{msg.detail}</pre>}
        </div>
      )}
      {busy && <div className="notice info">Working: {busy}… (allow pop-ups for the Tide window)</div>}

      {/* ---------- Setup ---------- */}
      <section className="card">
        <div className="spread">
          <h2>One-time setup</h2>
          <span className="small muted">{planStatus?.policiesSigned ?? 0}/{POLICY_PLAN.length} policies · {planStatus?.docs ?? 0} documents</span>
        </div>
        <div className="grid g2">
          <div className="stack">
            <p className="small">
              <b>1. Sign the folder policies.</b> One <code>RelationshipAttestation:1</code> policy per role and folder.
              Errand&apos;s policies exist from day one, but name roles nobody holds yet. A policy alone opens nothing.
            </p>
            <ul className="list small">
              {POLICY_PLAN.map((p) => (
                <li key={p.key} className="spread">
                  <span><code>{p.role}</code> → {p.folder} ({p.access})</span>
                  {signedKeys.has(p.key) || allSigned ? <Badge tone="ok">signed</Badge> : <Badge>not yet</Badge>}
                </li>
              ))}
            </ul>
            <button onClick={signPolicies} disabled={!!busy}>Sign all {POLICY_PLAN.length} policies</button>
          </div>
          <div className="stack">
            <p className="small">
              <b>2. Encrypt the synthetic documents.</b> Bills, Medical and ID files are encrypted here, tagged with
              their folder&apos;s record id, and uploaded as ciphertext.
            </p>
            <button onClick={seedDocs} disabled={!!busy || !ownerPolicy("bills")}>Encrypt &amp; upload {SEED_DOCS.length} documents</button>
          </div>
        </div>
      </section>

      {/* ---------- Errand's access ---------- */}
      <section className="card">
        <div className="spread">
          <h2>Errand&apos;s access</h2>
          {agentRoles && (
            <div className="row">
              {[ROLES.agentBills, ROLES.agentMedical].map((r) => (
                <Badge key={r} tone={agentRoles.includes(r) ? "ok" : undefined}>{r}: {agentRoles.includes(r) ? "held" : "no"}</Badge>
              ))}
            </div>
          )}
        </div>
        {igaError && <div className="notice warn small">Could not read TideCloak: {igaError}</div>}
        <p className="small muted">
          Granting a role is a TideCloak change request. The server files it; only your signature in the Tide window
          commits it. Revocation is the same: one signed change, effective on Errand&apos;s next session refresh.
        </p>
        <div className="row">
          <button onClick={grantBills} disabled={!!busy || agentRoles?.includes(ROLES.agentBills)}>Grant Errand: Bills (read)</button>
          <button className="danger" onClick={revokeAll} disabled={!!busy}>Revoke Errand</button>
        </div>
      </section>

      {/* ---------- Approvals ---------- */}
      <section className="card">
        <div className="spread">
          <h2>Approvals queue</h2>
          <button className="ghost" onClick={() => refresh()}>Refresh</button>
        </div>
        {openRequests.length === 0 && looseCRs.length === 0 && <p className="muted small">Nothing waiting for your signature.</p>}
        <ul className="list">
          {openRequests.map((r) => (
            <li key={r.id} className={r.suspicious || r.from === "operator" ? "flagged card tight" : "card tight"}>
              <div className="spread">
                <div>
                  <b>{r.from === "operator" ? "Operator" : "Errand"} asks for <code>{r.role}</code></b>{" "}
                  {r.from === "operator" && <Badge tone="bad">admin override attempt</Badge>}{" "}
                  {r.suspicious && r.from === "agent" && <Badge tone="bad">reason quotes a document</Badge>}
                  <div className="small muted">{r.reason}</div>
                  <div className="small muted">
                    {r.changeRequestId ? <>TideCloak change request <code>{r.changeRequestId}</code> — PENDING, does nothing until you sign.</> : "App request only — nothing filed in TideCloak yet."}
                  </div>
                </div>
                <div className="row">
                  <button className="ghost" onClick={() => denyRequest(r)} disabled={!!busy}>Deny</button>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => {
                      const cr = pending.find((c) => c.id === r.changeRequestId);
                      if (cr) signCR(cr);
                      else approveAgentRequest(r);
                    }}
                  >
                    Sign anyway
                  </button>
                </div>
              </div>
            </li>
          ))}
          {looseCRs.map((c) => (
            <li key={c.id} className={c.involvesAgent && !linkedCrIds.has(c.id) ? "flagged card tight" : "card tight"}>
              <div className="spread">
                <div>
                  <b>TideCloak change request: {c.actionType}</b> <Badge>{c.entityType}</Badge>{" "}
                  {c.involvesAgent && <Badge tone="bad">touches Errand</Badge>}
                  <div className="small muted">
                    <code>{c.id}</code> · approvals {c.authorizationCount ?? "?"}/{c.threshold ?? "?"}
                  </div>
                </div>
                <div className="row">
                  <button className="ghost" onClick={() => denyCR(c)} disabled={!!busy}>Deny</button>
                  <button className="secondary" onClick={() => signCR(c)} disabled={!!busy}>Sign</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Folders ---------- */}
      <section>
        <h3>Folders</h3>
        <div className="grid g3">
          {FOLDERS.map((f) => {
            const fd = docs.filter((d) => d.folder === f.id);
            return (
              <div key={f.id} className="card stack">
                <div className="spread">
                  <h2 className="row"><span className="folder-dot" style={{ background: f.colour }} /> {f.label}</h2>
                  <Badge>{f.recordId}</Badge>
                </div>
                <p className="small muted">
                  Agent access: {f.agentRole ? <code>{f.agentRole}</code> : "none — no policy exists for any agent role"}
                </p>
                {fd.length === 0 && <p className="small muted">No documents yet.</p>}
                <ul className="list small">
                  {fd.map((d) => (
                    <li key={d.id}>
                      <b>{d.title}</b>
                      {plain[d.id] ? <pre className="small">{pretty(plain[d.id])}</pre> : <div className="cipher">{d.ciphertext}</div>}
                    </li>
                  ))}
                </ul>
                {fd.length > 0 && <button className="secondary" onClick={() => decryptFolder(f.id)} disabled={!!busy}>Decrypt with Tide</button>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- Activity ---------- */}
      <section className="card">
        <h2>Activity</h2>
        <ul className="list small">
          {events.slice(0, 40).map((e) => (
            <li key={e.id}>
              <span className="muted mono">{e.at.slice(11, 19)}</span>{" "}
              <Badge tone={e.kind === "refused" || e.kind === "operator" ? "bad" : e.kind === "allowed" || e.kind === "grant" ? "ok" : e.kind === "request" ? "warn" : undefined}>{e.kind}</Badge>{" "}
              <b>{e.actor}</b>: {e.message}
              {e.detail && <div className="muted mono" style={{ whiteSpace: "pre-wrap" }}>{e.detail}</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
