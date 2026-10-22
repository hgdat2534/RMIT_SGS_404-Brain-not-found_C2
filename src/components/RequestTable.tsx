import type { AccessRequest } from "@/lib/server/store";
import { RiskPill, StatusPill } from "./ui";

const WHO: Record<AccessRequest["requestedBy"], string> = { owner: "You (owner)", agent: "The AI agent", operator: "Platform staff" };

/** Access requests, newest first. Approve/Deny buttons only when handlers are given (the owner's page). */
export function RequestTable({
  requests,
  busy = false,
  onApprove,
  onDeny,
}: {
  requests: AccessRequest[];
  busy?: boolean;
  onApprove?: (r: AccessRequest) => void;
  onDeny?: (r: AccessRequest) => void;
}) {
  if (!requests.length) return <p className="muted">No requests yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Request</th><th>Filed by</th><th>Risk</th><th>Status</th>{onApprove && <th />}</tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className={r.risk.level === "red" && r.status === "PENDING" ? "row-red" : ""}>
              <td>
                <b>{r.kind === "grant" ? "Give" : "Remove"}</b> <span className="badge badge-folder">{r.role}</span>
                <div className="muted">{r.reason}</div>
                <div className="muted small">Change request {r.changeRequestId?.slice(0, 8) ?? "-"} · {new Date(r.createdAt).toLocaleTimeString()}</div>
              </td>
              <td>{WHO[r.requestedBy]}<div className="muted small">{r.requesterName}</div></td>
              <td style={{ minWidth: 200 }}>
                <RiskPill level={r.risk.level} />
                <ul className="small" style={{ margin: "0.3rem 0 0" }}>{r.risk.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              </td>
              <td><StatusPill status={r.status} />{r.error && <div className="red small">{r.error}</div>}</td>
              {onApprove && (
                <td style={{ whiteSpace: "nowrap" }}>
                  {r.status === "PENDING" && (
                    <>
                      <button className="btn-primary btn-sm" disabled={busy} onClick={() => onApprove(r)}>Review &amp; sign</button>
                      <button className="btn-danger btn-sm" disabled={busy} onClick={() => onDeny?.(r)}>Deny</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
