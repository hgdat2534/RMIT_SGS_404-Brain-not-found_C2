import type { AuditEntry } from "@/lib/server/store";
import { findPerson } from "@/lib/domain/people";
import { Avatar } from "./ui";

const OUTCOME_PILL: Record<AuditEntry["outcome"], string> = { allowed: "pill-green", refused: "pill-red", queued: "pill-amber", info: "pill-grey" };

export function AuditTable({ entries, limit = 60 }: { entries: AuditEntry[]; limit?: number }) {
  if (!entries.length) return <p className="muted">Nothing yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Time</th><th>Who</th><th>What happened</th><th>Outcome</th></tr></thead>
        <tbody>
          {entries.slice(0, limit).map((e) => {
            const person = findPerson(e.actor);
            return (
              <tr key={e.id} className={e.outcome === "refused" ? "row-red" : ""}>
                <td className="small">{new Date(e.at).toLocaleTimeString()}</td>
                <td>
                  <div className="row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
                    <Avatar person={person} />
                    <span className="small">{person?.name ?? e.actor}</span>
                  </div>
                </td>
                <td>
                  {e.action}
                  {e.folderId && <span className="badge">{e.folderId}</span>}
                  <div className="muted small">{e.detail}</div>
                </td>
                <td><span className={`pill ${OUTCOME_PILL[e.outcome]}`}>{e.outcome}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
