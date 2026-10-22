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
import { Card, Explain, PageHead, RoleBadge, RoleList, StatusLine, StatusPill } from "@/components/ui";

const STEP_LABEL: Record<AgentStep["kind"], { text: string; className: string }> = {
  think: { text: "thinks", className: "muted" },
  tool: { text: "calls tool", className: "muted" },
  result: { text: "result", className: "green" },
  refused: { text: "refused", className: "red" },
  hijack: { text: "tricked", className: "amber" },
  done: { text: "done", className: "muted" },
};

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

  if (tide.isInitializing) return <p className="muted">Loading…</p>;
  if (!tide.authenticated) return <Card title="Errand agent console"><p>Sign in as the Errand agent to run it.</p><button className="btn-primary" onClick={tide.login}>Sign in</button></Card>;
  if (!tide.hasRealmRole(AGENT_ROLE)) {
    return (
      <Card title="This console is for the Errand agent account">
        <p>Your token does not carry <RoleBadge role={AGENT_ROLE} />. The agent runs under its own account so that it can never borrow a person&apos;s access.</p>
        <a className="btn" href="/access">See what you can open →</a>
      </Card>
    );
  }

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
    setStatus("Running the errand…");
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
      <PageHead
        title="Errand agent console"
        lead="The AI agent runs in this tab, signed in as its own account. Every tool it calls uses this account's token, never Maya's."
      />
      <StatusLine text={status} />

      <Card title="What the agent can open right now">
        <div className="row">
          <span className="muted">Folder roles in my current token:</span>
          <RoleList roles={folderRoles} empty="none yet" />
          <span className="spacer" />
          <button disabled={busy} onClick={refreshAccess}>Refresh my access</button>
        </div>
        <Explain>
          <p>
            The agent&apos;s permissions live <b>inside its signed token</b>. When Maya grants or revokes a folder, nothing changes for the
            agent until it fetches a new token with <b>Refresh my access</b>.
          </p>
        </Explain>
      </Card>

      <Card title={<>Task from Maya: &quot;Sort my bills and cancel anything I&apos;m not using.&quot;</>}>
        <Explain label="The trap">
          <p>
            This agent is <b>deliberately gullible</b>, like a model with no guardrails. The phone bill hides a line telling it to also
            export Maya&apos;s Medical folder, and it will try. Watch who stops it: not the agent&apos;s code, but the Tide network.
          </p>
        </Explain>
        <button className="btn-primary" disabled={busy} onClick={start}>Run errand</button>
        {steps.length > 0 && (
          <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
            <table className="timeline">
              <tbody>
                {steps.map((s, i) => (
                  <tr key={i} className={s.kind === "refused" || s.kind === "hijack" ? "row-red" : ""}>
                    <td><span className={`kind ${STEP_LABEL[s.kind].className}`}>{STEP_LABEL[s.kind].text}</span></td>
                    <td>{s.tool ? <code>{s.text}</code> : s.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {report && report.bills.length > 0 && (
        <Card title="Result: bill summary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vendor</th><th>Category</th><th>Amount</th><th>Due</th></tr></thead>
              <tbody>
                {report.bills.map((b) => (
                  <tr key={b.docId}><td>{b.vendor}</td><td>{b.category}</td><td>${b.amountDue.toFixed(2)}</td><td>{b.dueDate}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: "0.5rem" }}>Total: <b>${report.total.toFixed(2)}</b>{report.nextDue && <> · next due: {report.nextDue.vendor} on {report.nextDue.dueDate}</>}</p>
          {report.drafts.map((d) => (
            <div key={d.docId} className="doc">
              <b>Draft cancellation: {d.vendor}</b>
              <div className="muted small">Unused for {d.idleDays} days · saves ${d.monthlySaving.toFixed(2)}/month · not sent: Maya sends it herself</div>
              <pre>To: {d.to ?? "(no address found)"}{"\n"}Subject: {d.subject}{"\n\n"}{d.body}</pre>
            </div>
          ))}
        </Card>
      )}

      <Card title="My access requests">
        <p className="muted">When the agent is refused, the most it can do is ask. A request does nothing until Maya signs it.</p>
        {requests.length === 0 && <p className="muted">None.</p>}
        <div className="table-wrap">
          <table>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.kind === "grant" ? "Give" : "Remove"}</b> <RoleBadge role={r.role} /></td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="muted small">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
