"use client";
import { useTideCloak } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";
import { ROLES } from "@/lib/errand/model";

export default function HomePage() {
  const { authenticated, hasRealmRole, login, isInitializing } = useTideCloak();
  const [status, setStatus] = useState<{ policiesSigned: number; policiesPlanned: number; docs: number; pendingRequests: number } | null>(null);
  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  const role = authenticated ? (hasRealmRole(ROLES.owner) ? "owner" : hasRealmRole(ROLES.agent) ? "agent" : "none") : null;

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>An AI agent that can only open what you sign for.</h1>
          <p className="lede" style={{ marginTop: 10 }}>
            Errand handles life admin — bills, subscriptions, renewals — with its own Tide account and a narrow role.
            Your folders are encrypted in your browser. The Tide network decides every decrypt, so a hijacked agent, a
            rogue vendor server or an over-eager admin can ask for more, but cannot take it.
          </p>
          <div className="row">
            {isInitializing ? null : !authenticated ? (
              <button onClick={() => login()}>Sign in with Tide</button>
            ) : role === "owner" ? (
              <a className="btn" href="/vault">Open Maya&apos;s vault</a>
            ) : role === "agent" ? (
              <a className="btn" href="/agent">Open the agent console</a>
            ) : (
              <span className="notice warn small">This Tide account has no Errand role.</span>
            )}
            <a className="btn secondary" href="/operator">Operator view</a>
          </div>
        </div>
        <div className="card stack small">
          <h3>Who holds what</h3>
          <div><b>Maya</b> — <code>vault.owner</code>, the realm&apos;s only <code>tide-realm-admin</code>. Signs every grant.</div>
          <div><b>Errand</b> — its own Tide account, <code>errand.agent</code>. Gets <code>agent.bills.read</code> only when Maya signs.</div>
          <div><b>The server</b> — ciphertext, public policy bytes, a request queue. Its admin credential can file a change, never approve one.</div>
          {status && (
            <div className="muted">
              Setup: {status.policiesSigned}/{status.policiesPlanned} policies signed · {status.docs} encrypted documents · {status.pendingRequests} pending requests
            </div>
          )}
        </div>
      </div>

      <div className="grid g3">
        <div className="card">
          <h3>1 · Grant</h3>
          <p>Maya grants Errand the Bills role. The server files a change request; she signs it in the Tide window.</p>
        </div>
        <div className="card">
          <h3>2 · Work, then get hijacked</h3>
          <p>Errand summarises bills and drafts a cancellation. A bill tells it to export Medical. It tries. The Tide network refuses.</p>
        </div>
        <div className="card">
          <h3>3 · Ask, override, revoke</h3>
          <p>Errand can only file a request. The operator&apos;s admin grant just queues one too. Maya revokes; the next unlock fails.</p>
        </div>
      </div>
    </div>
  );
}
