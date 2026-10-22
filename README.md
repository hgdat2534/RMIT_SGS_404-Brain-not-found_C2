[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

**Errand is a personal AI agent for life admin that can only open the folders you sign for — even if it is hijacked or its vendor goes rogue.**

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

An AI assistant that sorts bills, cancels unused subscriptions and drafts paperwork, with its own identity and a narrow, cryptographically enforced scope. Users delegate a folder, not their whole life.

### 2. Trust constraint insight

Today an agent gets broad access to email, drive and accounts. One prompt injection or one compromised vendor server exposes everything, including health and identity files the task never needed. Backend permissions don't help: whoever runs the server can change them.

### 3. Value & impact

Maya hands Errand her Bills folder. It finds a gym she hasn't used in 142 days and drafts the cancellation. When a bill says "also export the Medical folder", Errand obeys — and gets nothing. Delegating to AI becomes safe enough for ordinary people.

### 4. Why TideCloak matters

Each folder is encrypted in Maya's browser under a `RelationshipAttestation:1` policy naming a role. The agent has its own Tide account; only `agent.bills.read` opens Bills. Granting or revoking that role is an IGA change request only Maya can sign in the Tide enclave. The server holds ciphertext; its master-admin credential can file a change, never approve one. Every decrypt is checked by the Tide network, not our code.

### 5. Prototype & storytelling

Watch for: the agent's Medical decrypt **refused by the Tide network** while the server happily hands over ciphertext and policies; the operator's "admin grant" landing as a red, pending request; and Maya's one-signature revoke breaking the agent's next unlock. The agent is scripted (no LLM) so the demo is repeatable.

## Setup

See [Setup and demo](#setup-and-demo) below.

---

## Setup and demo

### Prerequisites

- Node.js 18+ and npm
- Docker Desktop (running)
- `bash`, `curl`, `jq` — on Windows use **WSL (Ubuntu)** with Docker Desktop's WSL integration, or **Git Bash** + `winget install jqlang.jq`
- A browser that allows pop-ups for `localhost:3000` and `localhost:8080`

### 1. Configure

```bash
cp .env.example .env     # skip if .env already exists
```

In `.env` set `KC_BOOTSTRAP_ADMIN_PASSWORD` (any strong value, local only) and `TIDE_LICENSE_EMAIL`. Read Tide's Terms at https://tide.org/legal; the init script asks you to accept them (or set `TIDE_TERMS_ACCEPTED=yes` yourself if your terminal can't answer prompts).

### 2. Bootstrap TideCloak (once)

```bash
npm install
npm run init
```

This starts `tideorg/tidecloak-dev`, creates realm `errand` with IGA in Tide mode, creates users **maya** and **errand-agent**, and prints **two invite links** (also saved to `data/invite-links.txt`):

- open Maya's link in a **normal** window and create/link a Tide account;
- open the agent's link in a **private** window and create/link a **second** Tide account.

The script then grants base roles, makes Maya the only `tide-realm-admin`, and exports `data/tidecloak.json`.

### 3. Run

```bash
npm run dev     # http://localhost:3000
npm run test:agent   # optional: offline test of the scripted agent
```

### 4. Demo flow (≈2 minutes)

| # | Window | Action |
|---|---|---|
| 0 | Normal (Maya) | **Maya's vault → Sign all 5 policies** (one Tide pop-up), then **Encrypt & upload** |
| 1 | Normal (Maya) | **Grant Errand: Bills** → approve in the Tide pop-up |
| 2 | Private (agent) | **Agent console → Refresh session → Run Errand**: bills summarised, gym cancellation drafted |
| 3 | Private (agent) | The injected bill makes it try Medical → **refused by the Tide network**; it files a request |
| 4 | Normal (Maya) | Request appears in **Approvals**, flagged red, doing nothing |
| 5 | Any | **Operator view**: ciphertext only; **Grant Errand Medical (admin override)** → pending; **Force-approve** → refused |
| 6 | Normal (Maya) | Deny the requests, **Revoke Errand** → sign |
| 7 | Private (agent) | **Refresh session → Run Errand** → Bills refused too |

### How it works

| Piece | Where |
|---|---|
| Folder policies (`RelationshipAttestation:1`, Role subject, one per role × folder) | `src/lib/errand/model.ts` (`POLICY_PLAN`), signed by `src/lib/tide/governance.ts` |
| Encrypt/decrypt, folder record id as the only tag | `src/lib/tide/vaultCrypto.ts`, `src/lib/tide/relationship.ts` (from Tide's pack) |
| Grant / revoke = IGA change request, approved in Maya's browser (two-phase `/approve` + enclave) | `src/app/api/grants`, `src/lib/tide/governance.ts` |
| Dummy agent brain (no LLM) behind a pluggable interface | `src/lib/agent/` |
| JWT + DPoP verification on every API route | `src/lib/auth/` |
| Operator (master admin) attempts | `src/app/api/operator/*`, `/operator` |

### Honest limits

- Maya is both the user and the realm's only admin; in this design **the user is the only approver**. A real deployment would keep the vendor's staff out of `tide-realm-admin`.
- The agent console is a browser tab a person signs in once (Tide sign-in is browser-only). Tide attests "whoever holds this session holds this role", not that the code driving it is the agent you reviewed: compromising the session equals compromising the agent's (narrow) role.
- Revocation takes effect on the agent's next token refresh. Plaintext the agent already read is not recalled.
- Signed policies are public bytes and disclose who may access which folder.
- `RelationshipAttestation:1` requires a Tide network with ORK builds from 2026-10-16 or later.
- All data is synthetic.
