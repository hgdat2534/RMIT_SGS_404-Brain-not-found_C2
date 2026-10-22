"use client";

import { IAMService } from "@tidecloak/js";
import { useCallback, useEffect, useState } from "react";
import { FOLDERS, OWNER_ROLE, getFolder, requiredPolicies, type FolderId } from "@/lib/domain/folders";
import { useErrand, type DecryptedDocument, type FolderPayload } from "@/lib/client/useErrand";
import { SEED_DOCUMENTS } from "@/lib/seed/documents";
import { approveChangeRequest, denyChangeRequest, fetchAdminPolicy } from "@/lib/tide/approvals";
import { describeTideError } from "@/lib/tide/errors";
import { fromBase64, signVaultPolicies } from "@/lib/tide/vaultPolicies";
import type { AccessRequest, AuditEntry } from "@/lib/server/store";
import { AuditTable } from "@/components/AuditTable";

interface FolderSummary {
  id: FolderId;
  label: string;
  documentCount: number;
  policyRoles: string[];
}

export default function OwnerPage() {
  const { tide, api, iga, decryptFolder, audit, vendorId } = useErrand();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [agentFolders, setAgentFolders] = useState<FolderId[] | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [docs, setDocs] = useState<Partial<Record<FolderId, DecryptedDocument[]>>>({});

  const refresh = useCallback(async () => {
    try {
      const [v, r, a] = await Promise.all([
        api<{ folders: FolderSummary[] }>("/api/vault"),
        api<{ requests: AccessRequest[] }>("/api/requests"),
        api<{ audit: AuditEntry[] }>("/api/audit"),
      ]);
      setFolders(v.folders);
      setRequests(r.requests);
      setAuditLog(a.audit);
      const s = await api<{ folders: FolderId[] }>("/api/agent-status").catch(() => null);
      setAgentFolders(s ? s.folders : null);
    } catch (err) {
      setStatus(`Could not load: ${describeTideError(err)}`);
    }
  }, [api]);

  useEffect(() => {
    if (tide.authenticated) refresh();
  }, [tide.authenticated, refresh]);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(true);
    setStatus(`${label}...`);
    try {
      const done = await fn();
      setStatus(done || `${label}: done.`);
    } catch (err) {
      setStatus(`${label} failed: ${describeTideError(err)}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (tide.isInitializing) return <p>Loading...</p>;
  if (!tide.authenticated) return <p><button onClick={tide.login}>Sign in with Tide</button></p>;
  if (!tide.hasRealmRole(OWNER_ROLE)) return <p className="red">This page is for the vault owner. <a href="/">Home</a></p>;

  // 1. Setup -----------------------------------------------------------------------------------
  const signPolicies = () =>
    run("Signing 6 folder policies (approve in the Tide pop-up)", async () => {
      const adminPolicy = await fetchAdminPolicy(iga);
      const signed = await signVaultPolicies(requiredPolicies(), vendorId, adminPolicy);
      for (const p of signed) await api("/api/policies", { method: "POST", body: JSON.stringify(p) });
      return `Signed and stored ${signed.length} policies.`;
    });

  const encryptSeed = () =>
    run("Encrypting the sample documents in your browser", async () => {
      const payload = await api<{ policies: FolderPayload["policies"] }>("/api/policies");
      for (const folder of FOLDERS) {
        const policy = payload.policies.find((p) => p.folderId === folder.id && p.subjectRole === OWNER_ROLE);
        if (!policy) throw new Error(`Sign the folder policies first (no owner policy for ${folder.label})`);
        const items = SEED_DOCUMENTS[folder.id].map((d) => ({ data: JSON.stringify(d), tags: [folder.recordId] }));
        const out = await IAMService.doEncrypt(items, fromBase64(policy.policyB64));
        const ciphertexts = out.map((c) => (typeof c === "string" ? c : btoa(String.fromCharCode(...c))));
        await api("/api/vault", { method: "POST", body: JSON.stringify({ folderId: folder.id, ciphertexts }) });
      }
      return "Encrypted and uploaded the sample Bills, Medical and ID documents. The server only received ciphertext.";
    });

  // 2. Agent access -----------------------------------------------------------------------------
  const fileChange = (kind: "grant" | "revoke", folderId: FolderId) =>
    run(`Filing ${kind} for ${getFolder(folderId).label}`, async () => {
      const { request } = await api<{ request: AccessRequest }>("/api/requests", { method: "POST", body: JSON.stringify({ kind, folderId }) });
      if (request.status === "FAILED") return `Not filed: ${request.error}`;
      return `Change request filed. Nothing changes until you sign it below.`;
    });

  // 3. Approvals ----------------------------------------------------------------------------------
  const approve = (req: AccessRequest) =>
    run("Approving in the Tide enclave", async () => {
      if (!req.changeRequestId) throw new Error("This request has no TideCloak change request id");
      const result = await approveChangeRequest(iga, req.changeRequestId, tide.approveTideRequests);
      await audit({ action: `approve ${req.kind} ${req.role}`, folderId: req.folderId, outcome: "info", detail: `Signed by the owner in the Tide enclave. committed=${result.committed}` });
      return result.committed ? "Signed and committed. The agent sees it on its next token refresh." : `Signature recorded (${result.authCount ?? "?"}/${result.threshold ?? "?"}).`;
    });

  const deny = (req: AccessRequest) =>
    run("Denying", async () => {
      if (!req.changeRequestId) throw new Error("No change request id");
      await denyChangeRequest(iga, req.changeRequestId, "Denied by the vault owner");
      await audit({ action: `deny ${req.kind} ${req.role}`, folderId: req.folderId, outcome: "info", detail: "Denied by the owner." });
      return "Denied.";
    });

  // 4. Own documents --------------------------------------------------------------------------------
  const openFolder = (folderId: FolderId) =>
    run(`Decrypting ${getFolder(folderId).label}`, async () => {
      const plain = await decryptFolder(folderId, OWNER_ROLE);
      setDocs((d) => ({ ...d, [folderId]: plain }));
    });

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <>
      <nav>
        <a href="/">Home</a> <a href="/operator">Operator view</a>
        <span className="muted">Signed in as {tide.getValueFromIdToken("preferred_username")} (owner, realm admin)</span>
      </nav>
      <h1>Maya&apos;s vault</h1>
      {status && <p className="status">{status}</p>}

      <section>
        <h2>1. Set up the vault (once)</h2>
        <p className="muted">
          Each folder is one Tide record with two policies: <code>{OWNER_ROLE}</code> may read and write; <code>agent.&lt;folder&gt;.read</code> may only read.
        </p>
        <button disabled={busy} onClick={signPolicies}>Sign folder policies</button>
        <button disabled={busy} onClick={encryptSeed}>Encrypt sample documents</button>
        <table>
          <thead><tr><th>Folder</th><th>Documents (ciphertext)</th><th>Signed policies</th></tr></thead>
          <tbody>
            {folders.map((f) => (
              <tr key={f.id}><td>{f.label}</td><td>{f.documentCount}</td><td>{f.policyRoles.join(", ") || "none"}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>2. What Errand may open</h2>
        <p className="muted">From TideCloak&apos;s role mappings for the agent account. Grant and revoke both file a change request you sign below.</p>
        <table>
          <tbody>
            {FOLDERS.map((f) => {
              const has = agentFolders?.includes(f.id);
              return (
                <tr key={f.id}>
                  <td>{f.label}</td>
                  <td>{agentFolders === null ? "?" : has ? <span className="green">can read</span> : <span className="muted">no access</span>}</td>
                  <td>
                    {!has && <button disabled={busy} onClick={() => fileChange("grant", f.id)}>Grant {f.label}</button>}
                    {has && <button disabled={busy} onClick={() => fileChange("revoke", f.id)}>Revoke {f.label}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>3. Approval queue ({pending.length} pending)</h2>
        <p className="muted">Only you can sign these, in the Tide pop-up. The server, the agent and the operator can only file them.</p>
        <RequestTable requests={requests} busy={busy} onApprove={approve} onDeny={deny} />
      </section>

      <section>
        <h2>4. My documents</h2>
        {FOLDERS.map((f) => (
          <div key={f.id}>
            <button disabled={busy} onClick={() => openFolder(f.id)}>Decrypt {f.label}</button>
            {docs[f.id]?.map((d) => (
              <pre key={d.id}><b>{d.title}</b>{"\n"}{d.body}</pre>
            ))}
          </div>
        ))}
      </section>

      <section>
        <h2>5. Activity</h2>
        <button onClick={refresh}>Refresh</button>
        <AuditTable entries={auditLog} />
      </section>
    </>
  );
}

function RequestTable({ requests, busy, onApprove, onDeny }: { requests: AccessRequest[]; busy: boolean; onApprove: (r: AccessRequest) => void; onDeny: (r: AccessRequest) => void }) {
  if (!requests.length) return <p className="muted">No requests yet.</p>;
  return (
    <table>
      <thead><tr><th>Request</th><th>From</th><th>Risk</th><th>Status</th><th></th></tr></thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id} className={r.risk.level === "red" && r.status === "PENDING" ? "row-red" : ""}>
            <td>
              <b>{r.kind} {r.role}</b>
              <div className="muted">{r.reason}</div>
              <div className="muted">CR {r.changeRequestId ?? "-"} · {new Date(r.createdAt).toLocaleTimeString()}</div>
            </td>
            <td>{r.requestedBy} ({r.requesterName})</td>
            <td>
              <span className={r.risk.level}>{r.risk.level.toUpperCase()}</span>
              <ul style={{ margin: 0, paddingLeft: "1rem" }}>{r.risk.reasons.map((x) => <li key={x} className="muted">{x}</li>)}</ul>
            </td>
            <td>{r.status}{r.error && <div className="red">{r.error}</div>}</td>
            <td>
              {r.status === "PENDING" && (
                <>
                  <button disabled={busy} onClick={() => onApprove(r)}>Review &amp; sign</button>
                  <button disabled={busy} onClick={() => onDeny(r)}>Deny</button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
