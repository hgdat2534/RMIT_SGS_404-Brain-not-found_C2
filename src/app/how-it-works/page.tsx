// How TideCloak protects Errand, in plain words. Planned with Tide's agent pack (the Raziel MCP
// server): canon `agent-authority`, scenario `relationship-attestation` and its role matrix.

import { Avatar, Card, Explain, PageHead, RoleBadge } from "@/components/ui";
import { ADMIN_ROLE, AUDITOR_ROLE, DECRYPTOR_ROLE, FOLDERS, OWNER_ROLE, requiredPolicies, type FolderId } from "@/lib/domain/folders";
import { PEOPLE, type Person } from "@/lib/domain/people";

function rolesOf(p: Person) {
  return [...p.realmRoles, ...Object.values(p.clientRoles).flat()];
}

/** Can this person open the folder with the roles they START with? Same rule as the network's. */
function opens(p: Person, folderId: FolderId): "yes" | "no" | "later" {
  const roles = rolesOf(p);
  const subjects = requiredPolicies().filter((s) => s.folderId === folderId).map((s) => s.subjectRole);
  if (roles.includes(DECRYPTOR_ROLE) && subjects.some((r) => roles.includes(r))) return "yes";
  if (roles.includes(DECRYPTOR_ROLE) && p.colour === "agent") return "later";
  return "no";
}

const Yes = () => <span className="cell-yes">✓ yes</span>;
const No = () => <span className="cell-no">✕ no</span>;

export default function HowItWorksPage() {
  return (
    <>
      <PageHead
        title="How TideCloak protects Errand"
        lead="Three checks stand between anyone and Maya's documents. With real Tide, none of them runs on the Errand server, so taking over the server does not get you past them."
      />

      <Card title="The problem">
        <p>
          A normal bill-sorting assistant gets broad access to your email, files and accounts. One <b>prompt injection</b> (a line of text
          inside a document that tricks the AI), one careless support engineer or one hacked server, and everything is exposed, including
          health and identity files the task never needed. Permission checks inside the app do not help: whoever runs the server can
          change them.
        </p>
      </Card>

      <div className="grid grid-3">
        <Card step={1} title="Who are you?">
          <p className="small"><b>Sign-in.</b> TideCloak signs you in and gives your browser tab a <b>signed token</b>. The token is bound to a key that only that tab holds (DPoP), so a copied token is useless anywhere else.</p>
          <p className="muted small">Enforced by: TideCloak, checked on every API call.</p>
        </Card>
        <Card step={2} title="What may you do?">
          <p className="small"><b>Roles.</b> Your token lists your roles, such as <RoleBadge role="agent.bills.read" />. Changing a role is a <b>change request</b> that only Maya can approve, in her own Tide window. The server can only ask.</p>
          <p className="muted small">Enforced by: TideCloak&apos;s governance (IGA).</p>
        </Card>
        <Card step={3} title="Can you open this?">
          <p className="small"><b>Access check.</b> Every document is encrypted. To open one, the <b>Tide network</b> checks your token against the folder&apos;s signed policy, then helps decrypt. The Errand server never holds a key.</p>
          <p className="muted small">Enforced by: the Tide network, on every decrypt.</p>
        </Card>
      </div>

      <Card title="Where TideCloak fits">
        <div className="flow">
          <div className="flow-box">
            <span className="tag">1 · your browser</span>
            <h3>Maya, Sam, the agent…</h3>
            <p>Encrypts and decrypts documents locally. Each tab has its own signed-in session.</p>
          </div>
          <div className="flow-box">
            <span className="tag">2 · Errand server</span>
            <h3>The app</h3>
            <p>Stores <b>only encrypted text</b> and signed policies. Checks roles on its API. Can <b>file</b> requests, never approve them.</p>
          </div>
          <div className="flow-box tide">
            <span className="tag">3 · TideCloak</span>
            <h3>Identity &amp; roles</h3>
            <p>Signs people in, issues tokens with their roles, and holds every role change until Maya signs it.</p>
          </div>
          <div className="flow-box tide">
            <span className="tag">4 · Tide network</span>
            <h3>The keys</h3>
            <p>Decides every decrypt by reading the caller&apos;s own token. In real Tide the key is split across many independent servers.</p>
          </div>
        </div>
        <Explain label="The rule the network applies">
          <p>
            <b>A role alone opens nothing, and a policy alone opens nothing.</b> To read a folder you need both: a policy that names a role
            you hold (for example <RoleBadge role="household.bills.read" /> on Bills), and the general reading role <RoleBadge role={DECRYPTOR_ROLE} />.
          </p>
        </Explain>
      </Card>

      <Card title="Who can open what (at the start of the demo)">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                {FOLDERS.map((f) => <th key={f.id}>{f.label}</th>)}
                <th>Approve changes</th>
                <th>Activity log</th>
              </tr>
            </thead>
            <tbody>
              {PEOPLE.map((p) => {
                const roles = rolesOf(p);
                return (
                  <tr key={p.username}>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <Avatar person={p} />
                        <div><b>{p.name}</b><div className="muted small">{p.title}</div></div>
                      </div>
                    </td>
                    {FOLDERS.map((f) => {
                      const o = opens(p, f.id);
                      return <td key={f.id}>{o === "yes" ? <Yes /> : o === "later" ? <span className="cell-later">if Maya grants</span> : <No />}</td>;
                    })}
                    <td>{roles.includes(ADMIN_ROLE) ? <Yes /> : <No />}</td>
                    <td>{roles.includes(OWNER_ROLE) || roles.includes(AUDITOR_ROLE) ? <Yes /> : <No />}</td>
                  </tr>
                );
              })}
              <tr>
                <td><b>The Errand server</b><div className="muted small">or whoever hacks it</div></td>
                {FOLDERS.map((f) => <td key={f.id}><No /></td>)}
                <td><No /></td>
                <td><span className="cell-later">stores it</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Planned with Tide's agent pack">
        <p className="small">
          We used Tide&apos;s MCP server (the <i>Raziel</i> agent pack) to decide where TideCloak fits. Three pieces of its guidance shaped the design:
        </p>
        <ul className="small">
          <li><b>Agents get their own account, with exactly the roles they need</b>, and a human-owned session (the agent console tab). The backend must never auto-approve an agent&apos;s own request.</li>
          <li><b>Relationship policies with a role as subject</b> (the built-in <code>RelationshipAttestation:1</code> contract): one record per folder, one policy per role, and <RoleBadge role={DECRYPTOR_ROLE} /> needed on top.</li>
          <li><b>Server-side authorisation still applies</b>: the contract protects the data, the server&apos;s own role checks protect the API. Neither replaces the other.</li>
        </ul>
      </Card>

      <Card title="What is simulated in this build">
        <span id="simulated" />
        <p className="small">
          This submission runs without a live Tide network. TideCloak, the Tide window (enclave) and the Tide network are <b>simulated
          inside the app</b> (<code>src/lib/sim</code>), behind the same interfaces the real ones use. The app&apos;s own pages and API
          routes are the same code that runs against real TideCloak.
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Part</th><th>Works the same</th><th>Different in the simulation</th></tr></thead>
            <tbody>
              <tr>
                <td>Sign-in</td>
                <td className="small">Signed EdDSA tokens with roles, bound to the tab&apos;s key (DPoP); verified on every API call</td>
                <td className="small">You pick an account instead of entering your Tide password</td>
              </tr>
              <tr>
                <td>Roles &amp; approvals</td>
                <td className="small">Change requests; one pending per person; only a <RoleBadge role={ADMIN_ROLE} /> session can approve; changes apply at the next token refresh</td>
                <td className="small">The Tide window is a dialog inside the app&apos;s own page</td>
              </tr>
              <tr>
                <td>Access checks</td>
                <td className="small">Decrypt refused without the policy&apos;s role and <RoleBadge role={DECRYPTOR_ROLE} />; tags checked; read-only roles cannot write</td>
                <td className="small">The keys live in one file on this machine instead of being split across independent Tide servers</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
