// The operator view: everything the platform (this server) holds, and the most it can do.
//
// This page runs ON the server, with the server's full privileges - the store on disk and the
// TideCloak master-admin credential. That is the point: even with all of that, it shows only
// ciphertext, and its "grant" button can only queue a change request for Maya to sign.

import { revalidatePath } from "next/cache";
import { FOLDERS, isFolderId } from "@/lib/domain/folders";
import { fileAccessChange, syncRequests } from "@/lib/server/accessRequests";
import { getStore } from "@/lib/server/store";

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
      <nav><a href="/">Home</a></nav>
      <h1>Operator view</h1>
      <p className="muted">
        What the Errand platform holds. Documents are Tide ciphertext encrypted in Maya&apos;s browser; the server has no key and the
        master-admin credential cannot approve anything.
      </p>

      <section>
        <h2>Stored documents ({data.documents.length})</h2>
        <table>
          <thead><tr><th>Folder</th><th>Ciphertext (as stored)</th></tr></thead>
          <tbody>
            {data.documents.map((d) => (
              <tr key={d.id}><td>{d.folderId}</td><td><pre>{d.ciphertext.slice(0, 160)}...</pre></td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Signed policies ({data.policies.length})</h2>
        <table>
          <thead><tr><th>Folder</th><th>Subject role</th><th>Access</th><th>Policy bytes</th></tr></thead>
          <tbody>
            {data.policies.map((p) => (
              <tr key={`${p.folderId}-${p.subjectRole}`}><td>{p.folderId}</td><td>{p.subjectRole}</td><td>{p.access}</td><td className="muted">{p.policyB64.slice(0, 40)}...</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Admin &quot;grant&quot;</h2>
        <p className="muted">Uses the TideCloak master-admin credential. The result is a pending change request in Maya&apos;s queue, flagged red.</p>
        {FOLDERS.map((f) => (
          <form key={f.id} action={operatorGrant} style={{ display: "inline" }}>
            <input type="hidden" name="folderId" value={f.id} />
            <button type="submit">Grant agent {f.label}</button>
          </form>
        ))}
        <table>
          <thead><tr><th>Request</th><th>From</th><th>Status</th></tr></thead>
          <tbody>
            {[...requests].reverse().map((r) => (
              <tr key={r.id}>
                <td>{r.kind} {r.role} <span className="muted">CR {r.changeRequestId ?? "-"}</span>{r.error && <div className="red">{r.error}</div>}</td>
                <td>{r.requestedBy}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
