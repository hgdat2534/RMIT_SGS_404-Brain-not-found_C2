[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

**Errand** is a personal AI agent that handles life admin (bills, subscriptions, renewals) using only the keys you grant it, so it cannot read or do more even if it is hijacked or its vendor goes rogue.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

An AI assistant you can safely hand your paperwork to. Instead of "connect everything", you give Errand one folder-sized key, enforced by cryptography that neither the agent, its vendor nor the server can override.

### 2. Trust constraint insight

Today a bill-sorting agent gets broad access to email, documents and accounts. One prompt injection or compromised vendor server exposes everything, including health and identity files the task never needed. App permission checks don't help: whoever runs the server can change them.

### 3. Value & impact

People get an agent's time savings without betting their medical and identity records on its prompt hygiene. Example: a line in a phone bill tells the agent to "export the Medical folder". The attempt fails at the Tide network and becomes a red request only Maya can sign.

### 4. Why TideCloak matters

- Each folder (Bills, Medical, ID) is encrypted in the browser under a Tide `RelationshipAttestation` policy; the server stores only ciphertext.
- The agent has its own Tide account. A **Role** policy lets only `agent.bills.read` decrypt Bills, checked by the ORKs on every decrypt.
- Granting or revoking a folder role is an IGA change request: the server, agent or operator can file one; only Maya can sign it in the Tide enclave.

### 5. Prototype & storytelling

The agent summarises three bills and drafts a gym cancellation, then follows a planted injection and **the Tide network refuses the Medical decrypt**. Its request lands in Maya's queue flagged red; the operator's "grant" button only queues a request; after Maya revokes, the agent's next unlock fails.

<!-- Overview above: ≤ 300 words -->

## Setup

Requirements: **Docker Desktop** (with compose), **Node.js 20+**, **bash + curl + jq** (Git Bash on Windows: `winget install jqlang.jq`), and two Tide accounts (one for Maya, one for the agent; you create them while linking). Allow pop-ups for `localhost:3000` and `localhost:8080`.

```bash
npm install
cp .env.example .env    # set KC_BOOTSTRAP_ADMIN_PASSWORD, TIDE_LICENSE_EMAIL, TIDE_TERMS_ACCEPTED=yes (only if you agree to https://tide.org/legal)
npm run init            # starts TideCloak (docker compose), creates realm "errand", prints TWO invite links
```

Open the first invite link and link Maya's Tide account. Open the second one in a private window and link the agent's account. (The agent account's email is a plus-alias of the licence email, e.g. `you+errand-agent@gmail.com`; override with `AGENT_EMAIL`. If licensing fails with `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`, the Tide network had a transient error: run `npm run init` again.) The script then grants baseline roles, makes Maya the only `tide-realm-admin`, and writes `data/tidecloak.json`.

Run the app, either way:

```bash
npm run dev                           # http://localhost:3000
docker compose up -d --build app      # same app in a container
```

Tests (core logic, no TideCloak needed): `npm test`. Type check: `npm run typecheck`.

### Demo script (2 minutes)

1. **Maya** (normal window) → *Open my vault* → **Sign folder policies** (one Tide pop-up approves all 6) → **Encrypt sample documents**.
2. *What Errand may open* → **Grant Bills** → *Approval queue* → **Review & sign** (Tide pop-up).
3. **Agent** (private window, signed in as the agent account) → *Agent console* → **Refresh my access** → **Run errand**. It summarises three bills, drafts the gym cancellation, finds the injection in the phone bill, tries `read_folder(medical)` and is **refused by the Tide network**, then files `request_access(medical)`.
4. Maya's queue shows that request **flagged red**, with the reasons. It does nothing until she signs. She clicks **Deny**.
5. **Operator view** (`/operator`): only ciphertext and policies. **Grant agent ID** uses the TideCloak master-admin credential and still only queues a red request. Maya denies it.
6. Maya → **Revoke Bills** → **Review & sign**. Agent → **Refresh my access** → **Run errand** → Bills is refused.

TideCloak allows one pending change request per user, so resolve each request before filing the next.

### How it works

| Piece | Where |
|---|---|
| Folder policies (`RelationshipAttestation:1`, Role subjects: `vault.owner` read-write, `agent.<folder>.read` read-only) | `src/lib/domain/folders.ts`, `src/lib/tide/vaultPolicies.ts` |
| Encrypt/decrypt in the browser with the record id as the only tag | `src/lib/client/useErrand.ts` |
| Server: token + DPoP verification on every API route, ciphertext store | `src/lib/auth/*` (Tide template), `src/app/api/*`, `src/lib/server/store.ts` |
| Server files role changes as IGA change requests and never approves them | `src/lib/server/tidecloakAdmin.ts`, `src/lib/server/accessRequests.ts` |
| Owner approves in the Tide enclave, browser → TideCloak with her own token | `src/lib/tide/approvals.ts` |
| Scripted agent (deterministic stand-in for an LLM, deliberately gullible) | `src/lib/agent/*` |
| Risk flags for the approval queue | `src/lib/domain/risk.ts` |

### Honest limits

- **Maya is also the realm admin who approves.** In the demo, the user is the only approver; a real deployment would make each user the sole approver of their own agent's grants.
- **The agent is scripted**, not a live LLM, so the demo is repeatable. Tide's guarantees don't depend on how the agent reasons, only on which account its tools run under.
- **Tide has no headless sign-in**, so the agent runs in a browser tab that a person signs in once as the agent's account. Whoever controls that tab controls the agent's (narrow) authority.
- Revocation takes effect when the agent's token refreshes, and cannot recall plaintext the agent already read.
- Signed policies are public metadata (they say which role may open which folder), and the server's audit log records what browsers report.
- `RelationshipAttestation:1` needs a Tide network with ORKs from 2026-10-16 or later.
