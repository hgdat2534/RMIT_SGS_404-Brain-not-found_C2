"use client";

// The activity log, read-only: for Maya and for Kim, her auditor. Kim sees WHAT happened - who
// tried which folder, who filed and signed what - without being able to open a single document.

import { useCallback, useEffect, useState } from "react";
import { AUDITOR_ROLE, OWNER_ROLE } from "@/lib/domain/folders";
import { useErrand } from "@/lib/client/useErrand";
import { describeTideError } from "@/lib/tide/errors";
import type { AccessRequest, AuditEntry } from "@/lib/server/store";
import { AuditTable } from "@/components/AuditTable";
import { RequestTable } from "@/components/RequestTable";
import { Card, Explain, PageHead, RoleBadge, StatusLine } from "@/components/ui";

export default function AuditPage() {
  const { tide, api } = useErrand();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api<{ audit: AuditEntry[] }>("/api/audit"), api<{ requests: AccessRequest[] }>("/api/requests")]);
      setEntries(a.audit);
      setRequests(r.requests);
      setStatus("");
    } catch (err) {
      setStatus(`Could not load: ${describeTideError(err)}`);
    }
  }, [api]);

  useEffect(() => {
    if (tide.authenticated) load();
  }, [tide.authenticated, load]);

  if (tide.isInitializing) return <p className="muted">Loading…</p>;
  if (!tide.authenticated) return <Card title="Activity log"><p>Sign in as Maya or Kim to read the log.</p><button className="btn-primary" onClick={tide.login}>Sign in</button></Card>;
  if (!tide.hasRealmRole(OWNER_ROLE) && !tide.hasRealmRole(AUDITOR_ROLE)) {
    return (
      <Card title="The activity log is for the owner and the auditor">
        <p>Your token carries neither <RoleBadge role={OWNER_ROLE} /> nor <RoleBadge role={AUDITOR_ROLE} />. The API refuses the log to anyone else, too.</p>
        <a className="btn" href="/access">See what you can open →</a>
      </Card>
    );
  }

  const count = (o: AuditEntry["outcome"]) => entries.filter((e) => e.outcome === o).length;

  return (
    <>
      <PageHead title="Activity log" lead="Everything that happened in the vault: every decrypt that was allowed or refused, every request filed, signed or denied." />
      <StatusLine text={status} />

      <Explain label="What an auditor can and cannot see">
        <p>
          Kim holds <RoleBadge role={AUDITOR_ROLE} />, which lets the Errand server show her this log. She has no folder role and no
          <RoleBadge role="_tide_decryptor" />, so the Tide network would refuse to open any document for her. The log records what each
          browser reported; the refusals themselves were enforced by the network, not by this page.
        </p>
      </Explain>

      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <Card><div className="muted small">Opened</div><div style={{ fontSize: "1.6rem", fontWeight: 700 }} className="green">{count("allowed")}</div><div className="muted small">decrypts the network allowed</div></Card>
        <Card><div className="muted small">Refused</div><div style={{ fontSize: "1.6rem", fontWeight: 700 }} className="red">{count("refused")}</div><div className="muted small">attempts the network or server refused</div></Card>
        <Card><div className="muted small">Requests waiting</div><div style={{ fontSize: "1.6rem", fontWeight: 700 }} className="amber">{requests.filter((r) => r.status === "PENDING").length}</div><div className="muted small">for Maya&apos;s signature</div></Card>
      </div>

      <Card title="Access requests" aside={<button className="btn-sm" onClick={load}>Refresh</button>}>
        <RequestTable requests={requests} />
      </Card>

      <Card title="Every event">
        <AuditTable entries={entries} limit={200} />
      </Card>
    </>
  );
}
