import type { AuditEntry } from "@/lib/server/store";

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <p className="muted">Nothing yet.</p>;
  return (
    <table>
      <thead><tr><th>Time</th><th>Who</th><th>What</th><th>Outcome</th></tr></thead>
      <tbody>
        {entries.slice(0, 60).map((e) => (
          <tr key={e.id} className={e.outcome === "refused" ? "row-red" : ""}>
            <td>{new Date(e.at).toLocaleTimeString()}</td>
            <td>{e.actor}</td>
            <td>{e.action}{e.folderId ? ` [${e.folderId}]` : ""}<div className="muted">{e.detail}</div></td>
            <td className={e.outcome === "refused" ? "red" : e.outcome === "allowed" ? "green" : ""}>{e.outcome}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
