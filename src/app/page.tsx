"use client";

import { useTide } from "@tide-runtime";
import { Avatar, Card, Explain, PageHead, RoleList } from "@/components/ui";
import { PEOPLE, findPerson, type Person } from "@/lib/domain/people";
import { SIM_LOGIN_PAGE } from "@/lib/sim/constants";

/** Sign in as someone in a NEW tab: each tab keeps its own session, so the cast can run side by side. */
function signInLink(person: Person) {
  return `${SIM_LOGIN_PAGE}?as=${encodeURIComponent(person.username)}&return=${encodeURIComponent(person.home)}`;
}

export default function HomePage() {
  const { session } = useTide();
  const me = session.authenticated ? findPerson(session.getValueFromIdToken("preferred_username")) : undefined;

  return (
    <>
      <PageHead
        title="An AI assistant you can safely hand your paperwork to"
        lead={
          <>
            <b>Errand</b> is a personal AI agent for life admin: it sorts bills and drafts cancellations. Instead of
            &quot;connect everything&quot;, you give it the key to <b>one folder</b>. TideCloak and the Tide network enforce that key,
            so a tricked agent, a curious support engineer or a hacked server still cannot open the rest.
          </>
        }
      />

      {me && (
        <Card>
          <div className="row">
            <Avatar person={me} large />
            <div>
              <b>You are signed in as {me.name}</b> <span className="muted">· {me.title}</span>
              <div className="muted">{me.summary}</div>
            </div>
            <span className="spacer" />
            <a className="btn btn-primary" href={me.home}>Go to my page →</a>
          </div>
        </Card>
      )}

      <Card title="Meet the people in this demo">
        <Explain label="How to use this">
          <p>
            Each person has their own account and their own roles. Click <b>Open as …</b> to sign in as them in a <b>new tab</b>:
            every tab keeps its own session, so you can have Maya, the agent and Sam open side by side.
          </p>
        </Explain>
        <div className="grid grid-3">
          {PEOPLE.map((p) => (
            <div key={p.username} className="card person" style={{ margin: 0, boxShadow: "none" }}>
              <div className="person-head">
                <Avatar person={p} large />
                <div>
                  <b>{p.name}</b>
                  <small>{p.title}</small>
                </div>
              </div>
              <p className="small" style={{ margin: 0 }}>{p.summary}</p>
              <ul className="can-list">{p.can.map((c) => <li key={c}>{c}</li>)}</ul>
              <ul className="cannot-list">{p.cannot.map((c) => <li key={c}>{c}</li>)}</ul>
              <div className="small"><RoleList roles={[...p.realmRoles, ...Object.values(p.clientRoles).flat()]} /></div>
              <div>
                <a className="btn btn-sm" href={signInLink(p)} target="_blank" rel="noopener">Open as {p.name} ↗</a>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Try the demo (about 3 minutes)">
          <ol className="howto">
            <li><b>Maya</b> → <i>My vault</i> → <b>Sign folder policies</b>, then <b>Encrypt sample documents</b>.</li>
            <li>Maya → <b>Grant Bills</b> to the agent → in <i>Approval queue</i>, <b>Review &amp; sign</b>.</li>
            <li><b>Errand</b> (agent tab) → <b>Refresh my access</b> → <b>Run errand</b>. A hidden line in the phone bill tells it to export Medical. <b>The Tide network refuses.</b></li>
            <li>Maya sees the agent&apos;s request for Medical <b>flagged red</b>, and denies it.</li>
            <li><b>Sam</b> → <i>My access</i>: Bills opens, Medical and ID are refused.</li>
            <li><b>Alex</b> (support) files a grant: it only lands in Maya&apos;s queue, flagged red. <b>Kim</b> reads the activity log but no documents.</li>
            <li>Maya <b>revokes</b> Bills. After the agent refreshes its access, Bills is refused too.</li>
          </ol>
        </Card>
        <Card title="Why this is safe">
          <ul>
            <li><b>Sign-in</b>: every request carries a token signed by TideCloak and bound to that browser tab (DPoP), so a stolen token is useless.</li>
            <li><b>Roles</b>: what you may open is a role in your token. Only Maya can approve a role change, in her own Tide window.</li>
            <li><b>Access checks</b>: documents are encrypted. The Tide network checks your token against the folder&apos;s signed policy before it releases a key. The Errand server never has the key.</li>
          </ul>
          <a className="btn" href="/how-it-works">How it works →</a>
        </Card>
      </div>
    </>
  );
}
