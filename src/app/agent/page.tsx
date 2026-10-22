"use client";

// The agent console: a browser tab signed in ONCE, by a person, as the Errand agent's own Tide
// account (Tide has no headless sign-in). The scripted agent runs here and every tool it calls
// uses this tab's credential - so the agent can never do more than the agent account may.

import { useCallback, useEffect, useState } from "react";
import { AGENT_ROLE, getFolder, type FolderId } from "@/lib/domain/folders";
import { useErrand } from "@/lib/client/useErrand";
import { runErrand, type AgentStep, type AgentTools, type ErrandReport } from "@/lib/agent/errandAgent";
import { contractReason, describeTideError, isNetworkRefusal } from "@/lib/tide/errors";
import type { AccessRequest } from "@/lib/server/store";

export default function AgentConsole() {
  const { tide, api, decryptFolder, audit } = useErrand();
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [report, setReport] = useState<ErrandReport | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const loadRequests = useCallback(async () => {
    const r = await api<{ requests: AccessRequest[] }>("/api/requests").catch(() => null);
    if (r) setRequests(r.requests);
    const me = await api<{ realmRoles: string[] }>("/api/me").catch(() => null);
    if (me) setRoles(me.realmRoles);
  }, [api]);

  useEffect(() => {
    if (tide.authenticated) loadRequests();
  }, [tide.authenticated, loadRequests]);

  if (tide.isInitializing) return <p>Loading...</p>;
  if (!tide.authenticated) return <p><button onClick={tide.login}>Sign in with Tide (as the agent account)</button></p>;
  if (!tide.hasRealmRole(AGENT_ROLE)) return <p className="red">This console is for the Errand agent account. <a href="/">Home</a></p>;

  const tools: AgentTools = {
    async readFolder(folderId: FolderId) {
      const folder = getFolder(folderId);
      try {
        const docs = await decryptFolder(folderId, folder.agentRole);
        await audit({ action: "decrypt", folderId, outcome: "allowed", detail: `Tide network released ${docs.length} document(s) to the agent.` });
        return { ok: true, value: docs };
      } catch (err) {
        const refusedByNetwork = isNetworkRefusal(err);
        const error = contractReason(err) ?? describeTideError(err);
        await audit({
          action: "decrypt",
          folderId,
          outcome: "refused",
          detail: `${refusedByNetwork ? "Tide network refused the decrypt" : "Decrypt failed"}: ${error}`.slice(0, 1000),
        });
        return { ok: false, error, refusedByNetwork };
      }
    },
    async requestAccess(folderId, reason, trigger) {
      try {
        const { request } = await api<{ request: AccessRequest }>("/api/requests", {
          method: "POST",
          body: JSON.stringify({ folderId, reason, trigger }),
        });
        if (request.status === "FAILED") return { ok: false, error: request.error ?? "not filed", refusedByNetwork: false };
        return { ok: true, value: { requestId: request.id, changeRequestId: request.changeRequestId } };
      } catch (err) {
        return { ok: false, error: describeTideError(err), refusedByNetwork: false };
      }
    },
  };

  const start = async () => {
    setBusy(true);
    setSteps([]);
    setReport(null);
    setStatus("Running...");
    try {
      const result = await runErrand(tools, {
        ownerName: "Maya",
        today: new Date(),
        onStep: (s) => setSteps((prev) => [...prev, s]),
      });
      setReport(result);
      setStatus("");
    } catch (err) {
      setStatus(`Agent crashed: ${describeTideError(err)}`);
    } finally {
      setBusy(false);
      loadRequests();
    }
  };

  const refreshAccess = async () => {
    setBusy(true);
    try {
      // Role changes reach the agent only in a new token (gotcha #10).
      await tide.forceRefreshToken();
      setStatus("Token refreshed. Any role Maya granted or revoked now applies.");
    } catch (err) {
      setStatus(`Refresh failed: ${describeTideError(err)}`);
    } finally {
      setBusy(false);
      loadRequests();
    }
  };

  const folderRoles = roles.filter((r) => r.startsWith("agent."));

  return (
    <>
      <nav>
        <a href="/">Home</a>
        <span className="muted">Agent console - signed in as {tide.getValueFromIdToken("preferred_username")}</span>
      </nav>
      <h1>Errand agent console</h1>
      <p className="muted">Folder roles in my current token: {folderRoles.length ? folderRoles.join(", ") : "none"}</p>
      {status && <p className="status">{status}</p>}

      <section>
        <h2>Task: &quot;Sort my bills and cancel anything I&apos;m not using.&quot;</h2>
        <button disabled={busy} onClick={start}>Run errand</button>
        <button disabled={busy} onClick={refreshAccess}>Refresh my access</button>
        <table>
          <tbody>
            {steps.map((s, i) => (
              <tr key={i} className={s.kind === "refused" || s.kind === "hijack" ? "row-red" : ""}>
                <td style={{ width: 80 }} className={s.kind === "refused" ? "red" : s.kind === "hijack" ? "amber" : "muted"}>{s.kind}</td>
                <td>{s.tool ? <code>{s.text}</code> : s.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report && report.bills.length > 0 && (
        <section>
          <h2>Bill summary</h2>
          <table>
            <thead><tr><th>Vendor</th><th>Category</th><th>Amount</th><th>Due</th></tr></thead>
            <tbody>
              {report.bills.map((b) => (
                <tr key={b.docId}><td>{b.vendor}</td><td>{b.category}</td><td>${b.amountDue.toFixed(2)}</td><td>{b.dueDate}</td></tr>
              ))}
            </tbody>
          </table>
          <p>Total: <b>${report.total.toFixed(2)}</b>{report.nextDue && <> · next due: {report.nextDue.vendor} on {report.nextDue.dueDate}</>}</p>
          {report.drafts.map((d) => (
            <div key={d.docId}>
              <h2>Draft cancellation: {d.vendor}</h2>
              <p className="muted">Unused for {d.idleDays} days · saves ${d.monthlySaving.toFixed(2)}/month · not sent (Maya sends it herself)</p>
              <pre>To: {d.to ?? "(no address found)"}{"\n"}Subject: {d.subject}{"\n\n"}{d.body}</pre>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2>My access requests</h2>
        {requests.length === 0 && <p className="muted">None.</p>}
        <table>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}><td>{r.kind} {r.role}</td><td>{r.status}</td><td className="muted">{r.reason}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
