"use client";
import { useTideCloak } from "@tidecloak/nextjs";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ROLES } from "@/lib/errand/model";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/vault", label: "Maya's vault" },
  { href: "/agent", label: "Agent console" },
  { href: "/operator", label: "Operator view" },
];

export function TopBar() {
  const { authenticated, getValueFromToken, logout, login, isInitializing, hasRealmRole } = useTideCloak();
  const path = usePathname();
  const user = authenticated ? String(getValueFromToken("preferred_username") ?? "") : "";
  const role = authenticated ? (hasRealmRole(ROLES.owner) ? "owner" : hasRealmRole(ROLES.agent) ? "agent" : "no role") : "";
  return (
    <header className="topbar">
      <a className="brand" href="/">Err<span>and</span></a>
      <nav className="nav">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={path === l.href ? "active" : ""}>{l.label}</a>
        ))}
      </nav>
      <div className="who">
        {isInitializing ? "…" : authenticated ? (
          <>
            <span>Signed in as <b>{user}</b> <span className="badge">{role}</span></span>
            <button className="ghost" onClick={() => logout()}>Sign out</button>
          </>
        ) : (
          <button onClick={() => login()}>Sign in with Tide</button>
        )}
      </div>
    </header>
  );
}

/** UI gating only. Every API route checks the verified token and role on the server. */
export function RequireRole({ role, who, children }: { role: string; who: string; children: React.ReactNode }) {
  const { authenticated, isInitializing, login, hasRealmRole } = useTideCloak();
  useEffect(() => {
    if (!isInitializing && !authenticated) login();
  }, [isInitializing, authenticated, login]);
  if (isInitializing || !authenticated) return <div className="page"><p className="muted">Checking your Tide session…</p></div>;
  if (!hasRealmRole(role)) {
    return (
      <div className="page">
        <div className="notice warn">
          This page is for <b>{who}</b>. Your token does not carry the <code>{role}</code> role.
          Sign out and sign in with the right Tide account (use a private window for the second account).
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function Badge({ tone, children }: { tone?: "ok" | "bad" | "warn"; children: React.ReactNode }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}
