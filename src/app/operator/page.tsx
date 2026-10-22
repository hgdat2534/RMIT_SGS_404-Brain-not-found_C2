// The operator view: everything the platform (this server) holds, and the most it can do.
//
// This page runs ON the server, with the server's full privileges - the store on disk and the
// TideCloak master-admin credential. That is the point: even with all of that, it shows only
// ciphertext, and its "grant" button can only queue a change request for Maya to sign.

import { revalidatePath } from "next/cache";
import { FOLDERS, isFolderId } from "@/lib/domain/folders";
import { fileAccessChange, syncRequests } from "@/lib/server/accessRequests";
import { getStore } from "@/lib/server/store";
import { Card, Explain, PageHead, RoleBadge, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

async function operatorGrant(formData: FormData) {
  "use server";
  const folderId = formData.get("folderId");
  if (!isFolderId(folderId)) return;
  await fileAccessChange({
    kind: "grant",
    folderId,
    requestedBy: "operator",
    requesterName: "platform-operator",
    reason: "Operator console: grant the agent access (e.g. a support engineer, or a compromised vendor server).",
  }).catch(() => undefined);
  revalidatePath("/operator");
}

export default async function OperatorPage() {
  const store = getStore();
  const requests = await syncRequests().catch(() => store.listRequests());
  const data = store.read();

  return (
    <>
      <PageHead
        title="Server view"
        lead="Everything the Errand platform holds, seen with the server's full privileges. This is what a hacker who took over the server, or a vendor gone rogue, would get."
      />

      <Explain label="The point of this page">
        <p>
          This page needs no sign-in: it runs <b>on the server</b>, with the server&apos;s database and its TideCloak administrator
          password. Even so, it cannot show a single document, because the server never had the keys. And its &quot;grant&quot; buttons
          can only <b>ask</b>.
        </p>
      </Explain>

      <Card title={`Stored documents (${data.documents.length})`}>
        <p className="muted">Exactly what is on disk. Encrypted in Maya&apos;s browser before it was uploaded.</p>
        {data.documents.length === 0 && <p className="muted">Nothing yet. Maya has not encrypted her documents.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folder</th><th>Ciphertext, as stored</th></tr></thead>
            <tbody>
              {data.documents.map((d) => (
                <tr key={d.id}><td><span className="badge">{d.folderId}</span></td><td><code className="small" style={{ wordBreak: "break-all" }}>{d.ciphertext.slice(0, 140)}…</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Signed policies (${data.policies.length})`}>
        <p className="muted">Public by design: a policy only says <i>who</i> may open a folder. It opens nothing for anyone else.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folder</th><th>Who it lets in</th><th>Access</th><th>Signed bytes</th></tr></thead>
            <tbody>
              {data.policies.map((p) => (
                <tr key={`${p.folderId}-${p.subjectRole}`}>
                  <td><span className="badge">{p.folderId}</span></td>
                  <td><RoleBadge role={p.subjectRole} /></td>
                  <td>{p.access}</td>
                  <td className="muted small"><code>{p.policyB64.slice(0, 32)}…</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Use the administrator password to give the agent a folder">
        <Explain label="Try it">
          <p>
            These buttons use TideCloak&apos;s master-admin credential, the most powerful login the platform has. In a normal app this
            would quietly grant access. Here it only files a change request that lands in <b>Maya&apos;s queue, flagged red</b>.
          </p>
        </Explain>
        {FOLDERS.map((f) => (
          <form key={f.id} action={operatorGrant} style={{ display: "inline" }}>
            <input type="hidden" name="folderId" value={f.id} />
            <button type="submit" className="btn-danger">Grant agent {f.label}</button>
          </form>
        ))}
        <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead><tr><th>Request</th><th>Filed by</th><th>Status</th></tr></thead>
            <tbody>
              {[...requests].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{r.kind === "grant" ? "Give" : "Remove"} <RoleBadge role={r.role} /><div className="muted small">change request {r.changeRequestId?.slice(0, 8) ?? "-"}</div>{r.error && <div className="red small">{r.error}</div>}</td>
                  <td>{r.requestedBy}<div className="muted small">{r.requesterName}</div></td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
