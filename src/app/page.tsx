"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { AGENT_ROLE, OWNER_ROLE } from "@/lib/domain/folders";

export default function HomePage() {
  const { authenticated, login, logout, isInitializing, hasRealmRole, getValueFromIdToken } = useTideCloak();

  if (isInitializing) return <p>Loading...</p>;

  return (
    <>
      <h1>Errand</h1>
      <p className="muted">
        A personal AI agent for bills and subscriptions that can only open the folders you grant it. Folders are encrypted in
        your browser with Tide; the server stores ciphertext; the Tide network decides who can decrypt.
      </p>
      <section>
        {!authenticated ? (
          <>
            <p>Sign in as <b>Maya</b> (owner) in one window, and as the <b>Errand agent</b> account in another (private) window.</p>
            <button onClick={login}>Sign in with Tide</button>
          </>
        ) : (
          <>
            <p>Signed in as <b>{getValueFromIdToken("preferred_username")}</b></p>
            {hasRealmRole(OWNER_ROLE) && <p><a href="/owner">Open my vault (owner)</a></p>}
            {hasRealmRole(AGENT_ROLE) && <p><a href="/agent">Open the Errand agent console</a></p>}
            {!hasRealmRole(OWNER_ROLE) && !hasRealmRole(AGENT_ROLE) && <p className="red">This account has neither the owner nor the agent role.</p>}
            <button onClick={logout}>Sign out</button>
          </>
        )}
      </section>
      <section>
        <a href="/operator">Operator view</a> <span className="muted">- what the platform operator (the server) can see and do.</span>
      </section>
    </>
  );
}
