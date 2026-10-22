"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, RoleList } from "@/components/ui";
import { PEOPLE, findPerson, type Person } from "@/lib/domain/people";
import { saveSession, signIn } from "@/lib/sim/clientSession";

/** Only same-site paths, so the sign-in page cannot be used to bounce someone elsewhere. */
function returnPath(person: Person): string {
  const value = new URLSearchParams(window.location.search).get("return");
  if (!value || value === "/") return person.home;
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function SignInForm() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);

  const choose = async (person: Person) => {
    setBusy(person.username);
    setError("");
    try {
      saveSession(await signIn(person.username));
      window.location.assign(returnPath(person));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  // "Open as …" links on the home page arrive with ?as=<username>: sign straight in.
  useEffect(() => {
    const preset = findPerson(new URLSearchParams(window.location.search).get("as"));
    if (preset && !started.current) {
      started.current = true;
      choose(preset);
    }
  }, []);

  return (
    <div className="grid grid-2">
      {PEOPLE.map((p) => (
        <section key={p.username} className="card person" style={{ margin: 0 }}>
          <div className="person-head">
            <Avatar person={p} large />
            <div>
              <b>{p.name}</b> <span className="muted">@{p.username}</span>
              <small>{p.title}</small>
            </div>
          </div>
          <p className="small" style={{ margin: 0 }}>{p.summary}</p>
          <div className="small"><RoleList roles={[...p.realmRoles, ...Object.values(p.clientRoles).flat()]} /></div>
          <div>
            <button className="btn-primary" disabled={busy !== null} onClick={() => choose(p)}>
              {busy === p.username ? "Signing in…" : `Sign in as ${p.name}`}
            </button>
          </div>
        </section>
      ))}
      {error && <p className="status status-bad">{error}</p>}
    </div>
  );
}
