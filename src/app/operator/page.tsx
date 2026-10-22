"use client";
// What whoever runs the Errand server can see and do. No Tide sign-in: the operator IS the server.
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/Shell";
import { FOLDERS, ROLES, type AccessRequest, type StoredDoc, type StoredPolicy } from "@/lib/errand/model";

interface Dump {
  docs: StoredDoc[];
  policies: StoredPolicy[];
  requests: AccessRequest[];
  pendingChangeRequests: { id: string; actionType: string; entityType: string; status: string; error?: string }[];
  realm: { url: string; realm: string } | null;
  error?: string;
}

export default function OperatorPage() {
  const [dump, setDump] = useState<Dump | null>(null);
  const [out, setOut] = useState<{ title: string; body: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fetch("/api/operator/dump").then((r) => r.json()).then(setDump), []);
  useEffect(() => {
    load();
  }, [load]);

  const post = async (title: string, url: string, body: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setOut({ title: `${title} → HTTP ${r.status}`, body: await r.json() });
    } finally {
      setBusy(false);
      load();
    }
  };

  const lastOperatorCR = dump?.requests.find((r) => r.from === "operator" && r.status === "pending" && r.changeRequestId)?.changeRequestId;

  return (
    <div className="page stack">
      <div>
        <h1>Operator view</h1>
        <p className="lede">
          Everything the Errand server stores, shown raw, plus what its most powerful credential (the TideCloak master
          admin) can do. There is no plaintext here, and no key that would produce any.
        </p>
      </div>
      {dump?.error && <div className="notice bad">{dump.error}</div>}

      <section className="card stack">
        <h2>Try to give Errand Medical access</h2>
        <p className="small muted">
          The operator calls TideCloak&apos;s admin API with the master admin credential. On this IGA realm the call
          returns <code>202</code> and files a change request. It stays PENDING and shows up red in Maya&apos;s queue.
        </p>
        <div className="row">
          <button className="danger" disabled={busy} onClick={() => post("Grant agent.medical.read", "/api/operator/grant", { role: ROLES.agentMedical })}>
            Grant Errand Medical (admin override)
          </button>
          <button className="ghost" disabled={busy || !lastOperatorCR} onClick={() => post("Force-approve", "/api/operator/force-approve", { changeRequestId: lastOperatorCR })}>
            Force-approve it as the server
          </button>
        </div>
        {out && (
          <div className="notice info">
            <b>{out.title}</b>
            <pre className="small" style={{ marginTop: 6 }}>{JSON.stringify(out.body, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="card">
        <div className="spread">
          <h2>Stored documents</h2>
          <button className="ghost" onClick={load}>Reload</button>
        </div>
        <ul className="list small">
          {dump?.docs.map((d) => (
            <li key={d.id}>
              <div className="spread">
                <b>{d.title}</b>
                <Badge>{FOLDERS.find((f) => f.id === d.folder)?.label} · tag {d.recordId}</Badge>
              </div>
              <div className="cipher">{d.ciphertext}</div>
            </li>
          ))}
          {!dump?.docs.length && <li className="muted">No documents yet.</li>}
        </ul>
      </section>

      <div className="grid g2">
        <section className="card">
          <h2>Signed policies (public bytes)</h2>
          <ul className="list small">
            {dump?.policies.map((p) => (
              <li key={p.key}>
                <b>{p.key}</b> <Badge>role {p.role}</Badge> <Badge>{p.access}</Badge>
                <div className="cipher">{p.policyB64}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Pending TideCloak change requests</h2>
          <ul className="list small">
            {dump?.pendingChangeRequests.map((c, i) => (
              <li key={c.id ?? i}>
                {c.error ? <span className="muted">{c.error}</span> : <><code>{c.id}</code> {c.actionType} <Badge tone="warn">{c.status}</Badge></>}
              </li>
            ))}
            {!dump?.pendingChangeRequests.length && <li className="muted">None.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
