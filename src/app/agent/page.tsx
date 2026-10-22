"use client";
// The Errand agent console. A person signs this tab in ONCE with the agent's own Tide account
// (Tide sign-in is browser-only; there is no headless path). After that the agent acts with that
// session and nothing more: its brain can be fooled, its credential cannot be widened.
import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, RequireRole } from "@/components/Shell";
import { explainTideError, useApi } from "@/lib/tide/client";
import { decryptMany } from "@/lib/tide/vaultCrypto";
import { scriptedBrain } from "@/lib/agent/scriptedBrain";
import type { AgentResult, AgentStep, AgentTools, DecryptOutcome, EncryptedItem } from "@/lib/agent/types";
import { FOLDERS, ROLES, folderById, type FolderId, type StoredPolicy } from "@/lib/errand/model";

export default function AgentPage() {
  return (
    <RequireRole role={ROLES.agent} who="the Errand agent account">
      <AgentConsole />
    </RequireRole>
  );
}

function AgentConsole() {
  const { api } = useApi();
  const { getValueFromToken, forceRefreshToken, tokenExp } = useTideCloak();
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [running, setRunning] = useState(false);
  const [obey, setObey] = useState(true);
  const [probe, setProbe] = useState<{ title: string; outcome: DecryptOutcome; policyNote: string } | null>(null);
  const [serverView, setServerView] = useState<{ realmRoles: string[] } | null>(null);

  const tokenRoles: string[] = useMemo(() => {
    const ra = getValueFromToken("realm_access") as { roles?: string[] } | undefined;
    return (ra?.roles ?? []).filter((r) => r.startsWith("agent.") || r.startsWith("_tide_") || r === ROLES.agent).sort();
    // tokenExp changes on every refresh, so this recomputes after "Refresh session".
  }, [getValueFromToken, tokenExp]);

  const loadServerView = useCallback(() => api("/api/me").then(setServerView).catch(() => {}), [api]);
  useEffect(() => {
    loadServerView();
  }, [loadServerView, tokenExp]);

  const report = (kind: "allowed" | "refused", message: string, detail?: string) =>
    api("/api/audit", { method: "POST", body: JSON.stringify({ kind, message, detail }) }).catch(() => {});

  /** Pick a policy for the folder. First the ones the server says apply to me; if there are none,
   * a hijacked agent grabs whatever policy exists (the server hands them out). It will not help. */
  const pickPolicy = async (folder: FolderId): Promise<{ policy?: StoredPolicy; note: string }> => {
    const mine: StoredPolicy[] = (await api("/api/policies")).policies;
    const own = mine.find((p) => p.folder === folder);
    if (own) return { policy: own, note: `using policy ${own.key} (subject role ${own.role})` };
    const all: StoredPolicy[] = (await api("/api/policies?all=1")).policies;
    const any = all.find((p) => p.folder === folder && p.role !== ROLES.owner) ?? all.find((p) => p.folder === folder);
    if (any) return { policy: any, note: `no policy names a role I hold, so I used ${any.key} (subject role ${any.role}) that the server handed over` };
    return { note: "no policy exists for this folder at all" };
  };

  const decryptWith = async (folder: FolderId, items: EncryptedItem[], forcePolicy?: StoredPolicy): Promise<DecryptOutcome & { policyNote: string }> => {
    const f = folderById(folder)!;
    const { policy, note } = forcePolicy ? { policy: forcePolicy, note: `using ${forcePolicy.key} (subject role ${forcePolicy.role})` } : await pickPolicy(folder);
    if (!items.length) return { ok: false, error: "no documents in this folder yet", policyNote: note };
    if (!policy) {
      report("refused", `No policy for ${f.label}`, note);
      return { ok: false, error: "No policy exists that could open this folder", detail: note, policyNote: note };
    }
    try {
      const out = await decryptMany(items.map((i) => i.ciphertext), f.recordId, policy.policyB64);
      report("allowed", `Errand decrypted ${out.length} ${f.label} documents`, note);
      return { ok: true, items: items.map((it, i) => ({ id: it.id, title: it.title, plaintext: out[i] })), policyNote: note };
    } catch (e) {
      const t = explainTideError(e);
      report("refused", `Tide refused Errand's ${f.label} decrypt`, `${note}\n${t.detail}`);
      return { ok: false, error: t.headline, detail: `${note}\n\n${t.detail}`, policyNote: note };
    }
  };

  const tools: AgentTools = {
    listFolder: async (folder) => ((await api(`/api/docs?folder=${folder}`)).docs as EncryptedItem[]).map(({ id, title, ciphertext }) => ({ id, title, ciphertext })),
    decrypt: (folder, items) => decryptWith(folder, items),
    requestAccess: (input) => api("/api/requests", { method: "POST", body: JSON.stringify(input) }),
  };

  const runTask = async () => {
    setRunning(true);
    setSteps([]);
    setResult(null);
    try {
      const r = await scriptedBrain.run(
        { instruction: "Sort out my bills this month and cancel anything I'm not using.", obeyDocumentInstructions: obey, today: new Date().toISOString().slice(0, 10) },
        tools,
        (s) => setSteps((prev) => [...prev, s]),
      );
      setResult(r);
    } catch (e) {
      setSteps((prev) => [...prev, { kind: "refused", title: "Run failed", detail: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setRunning(false);
    }
  };

  const runProbe = async (title: string, folder: FolderId, policyKey?: string) => {
    setProbe(null);
    const items = await tools.listFolder(folder);
    let forced: StoredPolicy | undefined;
    if (policyKey) forced = ((await api("/api/policies?all=1")).policies as StoredPolicy[]).find((p) => p.key === policyKey);
    const out = await decryptWith(folder, items, forced);
    setProbe({ title, outcome: out, policyNote: out.policyNote });
  };

  return (
    <div className="page stack">
      <div>
        <h1>Errand agent console</h1>
        <p className="lede">
          This tab is signed in as the agent&apos;s own Tide account. The brain below is a scripted stand-in for an
          LLM ({scriptedBrain.name}). Whatever it decides, every decrypt is checked by the Tide network against this
          session&apos;s roles.
        </p>
      </div>

      <section className="card">
        <div className="spread">
          <h2>Session</h2>
          <button className="ghost" onClick={() => forceRefreshToken().then(loadServerView)}>Refresh session</button>
        </div>
        <div className="row">
          {tokenRoles.map((r) => <Badge key={r} tone={r.startsWith("agent.") ? "ok" : undefined}>{r}</Badge>)}
          {!tokenRoles.some((r) => r.startsWith("agent.")) && <Badge tone="warn">no folder role</Badge>}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Grants and revocations reach this session on its next refresh. Server sees: {serverView ? serverView.realmRoles.filter((r) => r.startsWith("agent.")).join(", ") || "no agent.* role" : "…"}
        </p>
      </section>

      <section className="card stack">
        <div className="spread">
          <h2>Task</h2>
          <label className="toggle">
            <input type="checkbox" checked={obey} onChange={(e) => setObey(e.target.checked)} />
            Hijackable brain (follows instructions found inside documents)
          </label>
        </div>
        <p><i>&ldquo;Sort out my bills this month and cancel anything I&apos;m not using.&rdquo;</i></p>
        <div className="row">
          <button onClick={runTask} disabled={running}>{running ? "Running…" : "Run Errand"}</button>
        </div>
        {steps.length > 0 && (
          <ol className="timeline">
            {steps.map((s, i) => (
              <li key={i}>
                <span className={`kind ${s.kind}`}>{s.kind}</span>
                <div>
                  <b>{s.title}</b>
                  {s.detail && (s.kind === "refused" ? <pre className="refusal small">{s.detail}</pre> : <pre className="small muted">{s.detail}</pre>)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {result && result.drafts.length > 0 && (
        <section className="card">
          <h2>Drafts for Maya to review</h2>
          {result.drafts.map((d) => (
            <div key={d.title} className="card tight" style={{ marginTop: 8 }}>
              <b>{d.title}</b>
              <pre className="small">{d.body}</pre>
            </div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h2>Attack probes</h2>
        <p className="small muted">
          Skip the brain and try directly. The server hands over every ciphertext and every policy it stores. The
          Tide network still checks who is asking.
        </p>
        <div className="row">
          <button className="secondary" onClick={() => runProbe("Open Medical with the agent's Medical policy", "medical", "agent-medical")}>Medical, agent policy</button>
          <button className="secondary" onClick={() => runProbe("Open Medical with Maya's owner policy", "medical", "owner-medical")}>Medical, Maya&apos;s policy</button>
          <button className="secondary" onClick={() => runProbe("Open Medical with the Bills policy", "medical", "agent-bills")}>Medical, Bills policy</button>
          <button className="secondary" onClick={() => runProbe("Open ID documents", "id")}>ID documents</button>
          <button className="secondary" onClick={() => runProbe("Open Bills (the granted folder)", "bills")}>Bills</button>
        </div>
        {probe && (
          <div className={`notice ${probe.outcome.ok ? "ok" : "bad"}`}>
            <b>{probe.title}: {probe.outcome.ok ? `opened ${probe.outcome.items.length} documents` : probe.outcome.error}</b>
            <pre className="small" style={{ marginTop: 6 }}>{probe.outcome.ok ? probe.policyNote : probe.outcome.detail}</pre>
          </div>
        )}
        <p className="small muted">
          Folders: {FOLDERS.map((f) => `${f.label} → tag ${f.recordId}`).join(" · ")}
        </p>
      </section>
    </div>
  );
}
