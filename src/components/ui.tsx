// Small presentational pieces shared by every page. No hooks, so server and client pages can both use them.

import type { ReactNode } from "react";
import { ADMIN_ROLE, DECRYPTOR_ROLE, ENCRYPTOR_ROLE, FOLDERS } from "@/lib/domain/folders";
import type { Person } from "@/lib/domain/people";

export function PageHead({ title, lead, children }: { title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </header>
  );
}

export function Card({ step, title, aside, children }: { step?: number; title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || step) && (
        <div className="card-title">
          {step !== undefined && <span className="step">{step}</span>}
          {title && <h2>{title}</h2>}
          {aside && <><span className="spacer" />{aside}</>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A plain-words note on what the reader is looking at and which party enforces it. */
export function Explain({ label = "What's happening", children }: { label?: string; children: ReactNode }) {
  return (
    <div className="explain">
      <div className="explain-label">{label}</div>
      {children}
    </div>
  );
}

const FOLDER_ROLES = new Set(FOLDERS.flatMap((f) => [f.agentRole, f.householdRole].filter(Boolean)));

export function RoleBadge({ role }: { role: string }) {
  const kind = role === ADMIN_ROLE ? "badge-admin" : FOLDER_ROLES.has(role) ? "badge-folder" : role === DECRYPTOR_ROLE || role === ENCRYPTOR_ROLE ? "badge-tide" : "";
  return <span className={`badge ${kind}`}>{role}</span>;
}

export function RoleList({ roles, empty = "no roles" }: { roles: string[]; empty?: string }) {
  if (!roles.length) return <span className="muted">{empty}</span>;
  return <>{roles.map((r) => <RoleBadge key={r} role={r} />)}</>;
}

export function Avatar({ person, large }: { person?: Pick<Person, "name" | "colour">; large?: boolean }) {
  const colour = person ? `var(--person-${person.colour})` : "#9aa1b2";
  return (
    <span className={`avatar${large ? " avatar-lg" : ""}`} style={{ background: colour }} aria-hidden="true">
      {(person?.name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function RiskPill({ level }: { level: "red" | "amber" | "green" }) {
  return <span className={`pill pill-${level}`}>{level.toUpperCase()}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "green" : status === "PENDING" ? "amber" : status === "DENIED" || status === "FAILED" ? "red" : "grey";
  return <span className={`pill pill-${tone}`}>{status}</span>;
}

/** Status line for long actions; tone follows the text it is given. */
export function StatusLine({ text }: { text: string }) {
  if (!text) return null;
  const tone = /failed|refused|denied|not filed|could not|risk RED/i.test(text) ? " status-bad" : /done|signed|stored|encrypted|committed|refreshed|filed/i.test(text) ? " status-ok" : "";
  return <p className={`status${tone}`} role="status">{text}</p>;
}
