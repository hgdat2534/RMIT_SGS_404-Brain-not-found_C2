"use client";

// Top bar. The links shown follow the roles in this tab's token - a convenience only: every page
// and API route checks again, and the Tide network checks every decrypt.

import { usePathname } from "next/navigation";
import { useTide } from "@tide-runtime";
import { AGENT_ROLE, AUDITOR_ROLE, OWNER_ROLE } from "@/lib/domain/folders";
import { findPerson } from "@/lib/domain/people";
import { Avatar } from "./ui";

export function AppHeader() {
  const { session } = useTide();
  const pathname = usePathname();
  const username = session.authenticated ? session.getValueFromIdToken("preferred_username") : undefined;
  const person = findPerson(username);

  const links = [
    { href: "/", label: "Home", show: true },
    { href: "/how-it-works", label: "How it works", show: true },
    { href: "/owner", label: "My vault", show: session.hasRealmRole(OWNER_ROLE) },
    { href: "/agent", label: "Agent console", show: session.hasRealmRole(AGENT_ROLE) },
    { href: "/access", label: "My access", show: session.authenticated },
    { href: "/audit", label: "Activity log", show: session.hasRealmRole(OWNER_ROLE) || session.hasRealmRole(AUDITOR_ROLE) },
    { href: "/operator", label: "Server view", show: true },
  ].filter((l) => l.show);

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/">
          <span className="brand-mark">E</span> Errand
        </a>
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <a key={l.href} href={l.href} className={pathname === l.href ? "active" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        {!session.isInitializing &&
          (session.authenticated ? (
            <div className="userchip">
              <Avatar person={person} />
              <span className="who">
                <b>{person?.name ?? String(username)}</b>
                <small>{person?.title ?? "signed in"}</small>
              </span>
              <button className="btn-sm" onClick={session.logout}>Sign out</button>
            </div>
          ) : (
            <button className="btn-primary btn-sm" onClick={session.login}>Sign in</button>
          ))}
      </div>
    </div>
  );
}
