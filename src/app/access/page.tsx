"use client";

// "My access" - for anyone signed in. Try to open each folder and see the Tide network decide, try
// the app's own API permissions, and (for platform support) file a request as the platform would.

import { useCallback, useEffect, useState } from "react";
import { DECRYPTOR_ROLE, FOLDERS, OWNER_ROLE, getFolder, requiredPolicies, type FolderId } from "@/lib/domain/folders";
import { findPerson } from "@/lib/domain/people";
import { useErrand, type DecryptedDocument } from "@/lib/client/useErrand";
import { contractReason, describeTideError, isNetworkRefusal } from "@/lib/tide/errors";
import type { AccessRequest } from "@/lib/server/store";
import { Avatar, Card, Explain, PageHead, RoleBadge, RoleList, StatusLine } from "@/components/ui";

interface Me {
  name: string;
  realmRoles: string[];
  clientRoles: string[];
  isSupport: boolean;
  tokenExpiresAt: number | null;
}

type Attempt =
  | { state: "allowed"; role: string; docs: DecryptedDocument[] }
  | { state: "refused"; role: string; reason: string; byNetwork: boolean }
  | { state: "empty"; role: string };

const API_CHECKS = [
  { path: "/api/audit", label: "Read the activity log", who: "owner and auditor" },
  { path: "/api/requests", label: "See access requests", who: "owner, auditor and the agent" },
  { path: "/api/agent-status", label: "See what the agent may open", who: "owner, auditor and the agent" },
];

export default function AccessPage() {
  const { tide, api, decryptFolder, audit } = useErrand();
  const [me, setMe] = useState<Me | null>(null);
  const [attempts, setAttempts] = useState<Partial<Record<FolderId, Attempt>>>({});
  const [apiResults, setApiResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const loadMe = useCallback(async () => setMe(await api<Me>("/api/me").catch(() => null)), [api]);
  useEffect(() => {
    if (tide.authenticated) loadMe();
  }, [tide.authenticated, loadMe]);

  if (tide.isInitializing) return <p className="muted">Loading…</p>;
  if (!tide.authenticated) {
    return (
      <Card title="My access">
        <p>Sign in as anyone to see what they can and cannot open.</p>
        <button className="btn-primary" onClick={tide.login}>Sign in</button>
      </Card>
    );
  }

  const person = findPerson(tide.getValueFromIdToken("preferred_username"));
  const roles = me?.realmRoles ?? [];

  /** The policy a person would use: one naming a role they hold, else the owner's (to show the refusal). */
  const roleFor = (folderId: FolderId) =>
    requiredPolicies().filter((p) => p.folderId === folderId).map((p) => p.subjectRole).find((r) => roles.includes(r)) ?? OWNER_ROLE;

  const tryFolder = async (folderId: FolderId) => {
    const role = roleFor(folderId);
    setBusy(true);
    try {
      const docs = await decryptFolder(folderId, role);
      setAttempts((a) => ({ ...a, [folderId]: docs.length ? { state: "allowed", role, docs } : { state: "empty", role } }));
      if (docs.length) await audit({ action: "decrypt", folderId, outcome: "allowed", detail: `Tide network released ${docs.length} document(s) under ${role}.` });
    } catch (err) {
      const byNetwork = isNetworkRefusal(err);
      const reason = contractReason(err) ?? describeTideError(err);
      setAttempts((a) => ({ ...a, [folderId]: { state: "refused", role, reason, byNetwork } }));
      await audit({ action: "decrypt", folderId, outcome: "refused", detail: `${byNetwork ? "Tide network refused the decrypt" : "Decrypt failed"}: ${reason}`.slice(0, 1000) });
    } finally {
      setBusy(false);
    }
  };

  const tryApis = async () => {
    setBusy(true);
    const out: Record<string, { ok: boolean; message: string }> = {};
    for (const check of API_CHECKS) {
      try {
        await api(check.path);
        out[check.path] = { ok: true, message: "Allowed" };
      } catch (err) {
        out[check.path] = { ok: false, message: describeTideError(err) };
      }
    }
    setApiResults(out);
    setBusy(false);
  };

  const supportGrant = async (folderId: FolderId) => {
    setBusy(true);
    setStatus(`Filing a request to give the agent ${getFolder(folderId).label}…`);
    try {
      const { request } = await api<{ request: AccessRequest }>("/api/requests", { method: "POST", body: JSON.stringify({ folderId }) });
      setStatus(
        request.status === "FAILED"
          ? `Not filed: ${request.error}`
          : `Request filed, status ${request.status}, risk ${request.risk.level.toUpperCase()}. It sits in Maya's queue; you cannot approve it.`,
      );
    } catch (err) {
      setStatus(`Could not file: ${describeTideError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="My access" lead="What your account can open, checked live by the same parties that would check it in production." />
      <StatusLine text={status} />

      <Card>
        <div className="row">
          <Avatar person={person} large />
          <div>
            <b>{person?.name ?? me?.name}</b> <span className="muted">· {person?.title}</span>
            <div className="small" style={{ marginTop: "0.2rem" }}>
              Roles in my token: <RoleList roles={[...roles, ...(me?.clientRoles ?? [])]} />
            </div>
          </div>
          <span className="spacer" />
          <button className="btn-sm" disabled={busy} onClick={async () => { await tide.forceRefreshToken(); await loadMe(); }}>Refresh my token</button>
        </div>
        <Explain label="Where these roles come from">
          <p>
            TideCloak put these roles into your <b>signed token</b> when you signed in. The app and the Tide network both read them from
            that token, so nobody can add a role by editing the page. Roles change only through a request Maya signs.
          </p>
        </Explain>
      </Card>

      <Card title="Try to open each folder">
        <Explain>
          <p>
            The Errand server happily gives <b>everyone</b> the encrypted documents and the folder&apos;s policy: on their own they are
            useless. To decrypt, the <b>Tide network</b> checks two things in your token: the role the policy names, and
            <RoleBadge role={DECRYPTOR_ROLE} />. Missing either, it refuses.
          </p>
        </Explain>
        {FOLDERS.map((f) => {
          const attempt = attempts[f.id];
          return (
            <div key={f.id} className="folder-row" style={{ display: "block" }}>
              <div className="row">
                <div className="folder-name"><b>{f.label}</b><small>{f.description}</small></div>
                <span className="muted small">tries the policy for <RoleBadge role={roleFor(f.id)} /></span>
                <span className="spacer" />
                <button disabled={busy || !me} onClick={() => tryFolder(f.id)}>Try to open {f.label}</button>
              </div>
              {attempt?.state === "allowed" && (
                <div className="result result-ok">
                  <b className="green">Opened.</b> The network found <RoleBadge role={attempt.role} /> in your token and helped decrypt {attempt.docs.length} document(s):
                  {attempt.docs.map((d) => <div key={d.id} className="doc"><b>{d.title}</b><pre>{d.body}</pre></div>)}
                </div>
              )}
              {attempt?.state === "empty" && <div className="result result-ok">Allowed, but the folder is empty. Maya has not encrypted her sample documents yet.</div>}
              {attempt?.state === "refused" && (
                <div className="result result-bad">
                  <b className="red">{attempt.byNetwork ? "Refused by the Tide network." : "Could not open."}</b> {attempt.reason}
                  {attempt.byNetwork && <div className="small" style={{ marginTop: "0.2rem" }}>You received the encrypted documents, but no key. Nothing the Errand server, its staff or this page does can change that answer.</div>}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <Card title="Try the app's own permissions">
        <Explain>
          <p>
            Separate from the network&apos;s check, the Errand server checks your token&apos;s roles on every API call. This protects the
            app&apos;s own data, such as the activity log, which is not encrypted.
          </p>
        </Explain>
        <button disabled={busy} onClick={tryApis}>Run the checks</button>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Allowed for</th><th>You</th></tr></thead>
            <tbody>
              {API_CHECKS.map((c) => {
                const r = apiResults[c.path];
                return (
                  <tr key={c.path}>
                    <td>{c.label}<div className="muted small"><code>GET {c.path}</code></div></td>
                    <td className="small">{c.who}</td>
                    <td>{r ? <span className={`pill ${r.ok ? "pill-green" : "pill-red"}`}>{r.ok ? "allowed" : "403 forbidden"}</span> : <span className="muted">-</span>}{r && !r.ok && <div className="muted small">{r.message}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {me?.isSupport && (
        <Card title="Support tools: ask to give the agent a folder">
          <Explain label="Insider test">
            <p>
              Alex has real access to Errand&apos;s systems. What happens if he (or someone who stole his login) tries to widen the
              agent&apos;s access? The server files a change request in TideCloak, and that is all: it lands in Maya&apos;s queue flagged red,
              and only her signature can approve it.
            </p>
          </Explain>
          {FOLDERS.map((f) => (
            <button key={f.id} disabled={busy} onClick={() => supportGrant(f.id)}>Give the agent {f.label}</button>
          ))}
        </Card>
      )}
    </>
  );
}
