"use client";

import { useCallback, useEffect, useState } from "react";
import { FOLDERS, OWNER_ROLE, getFolder, requiredPolicies, type FolderId } from "@/lib/domain/folders";
import { useErrand, type DecryptedDocument, type FolderPayload } from "@/lib/client/useErrand";
import { fromBase64 } from "@/lib/encoding";
import { SEED_DOCUMENTS } from "@/lib/seed/documents";
import { approveChangeRequest, denyChangeRequest, fetchAdminPolicy } from "@/lib/tide/approvals";
import { describeTideError } from "@/lib/tide/errors";
import type { AccessRequest, AuditEntry } from "@/lib/server/store";
import { AuditTable } from "@/components/AuditTable";
import { RequestTable } from "@/components/RequestTable";
import { Card, Explain, PageHead, RoleBadge, StatusLine } from "@/components/ui";

interface FolderSummary {
  id: FolderId;
  label: string;
  documentCount: number;
  policyRoles: string[];
}

export default function OwnerPage() {
  const { tide, ops, api, iga, decryptFolder, audit, vendorId } = useErrand();
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

  if (tide.isInitializing) return <p className="muted">Loading…</p>;
  if (!tide.authenticated) return <Card title="Maya's vault"><p>Sign in as Maya to open the vault.</p><button className="btn-primary" onClick={tide.login}>Sign in</button></Card>;
  if (!tide.hasRealmRole(OWNER_ROLE)) {
    return (
      <Card title="This page is for the vault owner">
        <p>Your token does not carry the <RoleBadge role={OWNER_ROLE} /> role, so the app will not show you the vault controls, and the API would refuse them anyway.</p>
        <a className="btn" href="/access">See what you can open →</a>
      </Card>
    );
  }

  const policyCount = requiredPolicies().length;

  // 1. Setup -----------------------------------------------------------------------------------
  const signPolicies = () =>
    run(`Signing ${policyCount} folder policies (approve in the Tide window)`, async () => {
      const adminPolicy = await fetchAdminPolicy(iga);
      const signed = await ops.signVaultPolicies(requiredPolicies(), vendorId, adminPolicy);
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
        const ciphertexts = await ops.encrypt(items, fromBase64(policy.policyB64));
        await api("/api/vault", { method: "POST", body: JSON.stringify({ folderId: folder.id, ciphertexts }) });
      }
      return "Encrypted and uploaded the sample Bills, Medical and ID documents. The server only received ciphertext.";
    });

  // 2. Agent access -----------------------------------------------------------------------------
  const fileChange = (kind: "grant" | "revoke", folderId: FolderId) =>
    run(`Filing ${kind} for ${getFolder(folderId).label}`, async () => {
      const { request } = await api<{ request: AccessRequest }>("/api/requests", { method: "POST", body: JSON.stringify({ kind, folderId }) });
      if (request.status === "FAILED") return `Not filed: ${request.error}`;
      return `Change request filed. Nothing changes until you sign it in the approval queue below.`;
    });

  // 3. Approvals ----------------------------------------------------------------------------------
  const approve = (req: AccessRequest) =>
    run("Approving in the Tide window", async () => {
      if (!req.changeRequestId) throw new Error("This request has no TideCloak change request id");
      const result = await approveChangeRequest(iga, req.changeRequestId, tide.approveTideRequests);
      await audit({ action: `approve ${req.kind} ${req.role}`, folderId: req.folderId, outcome: "info", detail: `Signed by the owner in the Tide enclave. committed=${result.committed}` });
      return result.committed ? "Signed and committed. The agent gets it the next time it refreshes its access." : `Signature recorded (${result.authCount ?? "?"}/${result.threshold ?? "?"}).`;
    });

  const deny = (req: AccessRequest) =>
    run("Denying", async () => {
      if (!req.changeRequestId) throw new Error("No change request id");
      await denyChangeRequest(iga, req.changeRequestId, "Denied by the vault owner");
      await audit({ action: `deny ${req.kind} ${req.role}`, folderId: req.folderId, outcome: "info", detail: "Denied by the owner." });
      return "Denied. Nothing changed.";
    });

  // 4. Own documents --------------------------------------------------------------------------------
  const openFolder = (folderId: FolderId) =>
    run(`Decrypting ${getFolder(folderId).label}`, async () => {
      const plain = await decryptFolder(folderId, OWNER_ROLE);
      setDocs((d) => ({ ...d, [folderId]: plain }));
      return `Decrypted ${plain.length} ${getFolder(folderId).label} document(s) in your browser.`;
    });

  const pending = requests.filter((r) => r.status === "PENDING");
  const setUp = folders.length > 0 && folders.every((f) => f.documentCount > 0);

  return (
    <>
      <PageHead
        title="Maya's vault"
        lead="Your documents, who may open them, and the requests waiting for your signature."
      />
      <StatusLine text={status} />

      <Card step={1} title="Set up the vault (once)" aside={setUp ? <span className="pill pill-green">done</span> : undefined}>
        <Explain>
          <p>
            Each folder gets a few <b>policies</b>. A policy is a signed rule like <i>&quot;whoever holds role <code>agent.bills.read</code> may
            read the Bills folder&quot;</i>. You approve all {policyCount} at once in the Tide window. Then the sample documents are
            <b> encrypted in your browser</b>: the Errand server only ever receives scrambled text.
          </p>
        </Explain>
        <button className="btn-primary" disabled={busy} onClick={signPolicies}>Sign folder policies</button>
        <button disabled={busy} onClick={encryptSeed}>Encrypt sample documents</button>
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead><tr><th>Folder</th><th>Encrypted documents</th><th>Who a policy lets in</th></tr></thead>
            <tbody>
              {folders.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.label}</b><div className="muted small">{getFolder(f.id).description}</div></td>
                  <td>{f.documentCount}</td>
                  <td>{f.policyRoles.length ? f.policyRoles.map((r) => <RoleBadge key={r} role={r} />) : <span className="muted">no policies yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card step={2} title="What Errand (the AI agent) may open">
        <Explain>
          <p>
            Pressing <b>Grant</b> does not give anything yet. It files a <b>change request</b> in TideCloak, which waits in step 3
            until you sign it. The same is true when the agent or the platform&apos;s staff ask: nobody but you can approve.
          </p>
        </Explain>
        {FOLDERS.map((f) => {
          const has = agentFolders?.includes(f.id);
          return (
            <div key={f.id} className="folder-row">
              <div className="folder-name"><b>{f.label}</b><small>{f.sensitivity === "high" ? "Sensitive" : "Everyday"} · role <code>{f.agentRole}</code></small></div>
              <div style={{ minWidth: 110 }}>{agentFolders === null ? <span className="muted">?</span> : has ? <span className="pill pill-green">can read</span> : <span className="pill pill-grey">no access</span>}</div>
              <span className="spacer" />
              {!has && <button disabled={busy} onClick={() => fileChange("grant", f.id)}>Grant {f.label}</button>}
              {has && <button className="btn-danger" disabled={busy} onClick={() => fileChange("revoke", f.id)}>Revoke {f.label}</button>}
            </div>
          );
        })}
        <p className="muted small" style={{ marginTop: "0.5rem" }}>Sam (household) already has <code>household.bills.read</code>, so Sam can read Bills and nothing else.</p>
      </Card>

      <Card step={3} title={`Approval queue (${pending.length} waiting)`}>
        <Explain>
          <p>
            <b>Review &amp; sign</b> opens the Tide window, where you approve with your own session. Requests flagged
            <span className="pill pill-red" style={{ margin: "0 0.3rem" }}>RED</span>
            deserve a second look: a sensitive folder, a request from the agent itself, from platform staff, or one prompted by text found
            inside a document (a possible prompt injection).
          </p>
        </Explain>
        <RequestTable requests={requests} busy={busy} onApprove={approve} onDeny={deny} />
      </Card>

      <Card step={4} title="My documents">
        <Explain>
          <p>The server hands your browser the scrambled text. The Tide network checks that your token holds <RoleBadge role={OWNER_ROLE} /> before it helps decrypt.</p>
        </Explain>
        {FOLDERS.map((f) => (
          <div key={f.id} className="folder-row" style={{ display: "block" }}>
            <div className="row">
              <div className="folder-name"><b>{f.label}</b><small>{f.description}</small></div>
              <span className="spacer" />
              <button disabled={busy} onClick={() => openFolder(f.id)}>Decrypt {f.label}</button>
            </div>
            {docs[f.id]?.map((d) => (
              <div key={d.id} className="doc"><b>{d.title}</b><pre>{d.body}</pre></div>
            ))}
          </div>
        ))}
      </Card>

      <Card step={5} title="Recent activity" aside={<a className="btn btn-sm" href="/audit">Full log →</a>}>
        <button className="btn-sm" onClick={refresh}>Refresh</button>
        <AuditTable entries={auditLog} limit={10} />
      </Card>
    </>
  );
}
