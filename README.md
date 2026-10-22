[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

# BlindVault

**Blind review where nobody — not the admin, not the chair, not us — learns who a candidate is until every judge has locked their score.**

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![TideCloak](https://img.shields.io/badge/Auth-TideCloak-0a7cff)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white)
![Status](https://img.shields.io/badge/status-hackathon%20prototype-orange)

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked) for the **RMIT × Tide "UNLOCKED" Hackathon 2026** (Industry Challenge) — team _404 Brain Not Found_.

## Vision & originality

Three judges, forty portfolios, one scholarship. It's called "blind", yet anyone in IT can open the database and see whose work is whose. BlindVault makes blindness a property of the data, not a promise: identities are encrypted in the candidate's browser, scores are locked first, and names appear only when the whole panel has finished.

## Trust constraint insight

Blind review today means trusting whoever runs the system: DB admins, chairs, cloud operators. Any of them can unmask a candidate early, and nobody can prove they didn't. Remove that bottleneck and institutions can _prove_ to applicants that nobody peeked.

## Value & impact

Students, grant applicants and job candidates are judged on their work, not their name or school. Committees get a publishable audit trail. Example: `#BV-8041` holds one locked score and no name; Huỳnh Gia Đạt appears only after two more judges sign in and lock theirs.

## Why TideCloak matters

- Judges sign in through TideCloak; tokens carry `_tide_message.selfencrypt` / `selfdecrypt` roles.
- Identities are sealed with TideCloak tag-based E2EE (`doEncrypt`, tag `message`); our server stores ciphertext and holds no key.
- With ordinary RBAC, whoever owns the server owns the key. With TideCloak, the key never sits on our server.

Honest limit: the 3-of-3 rule is still app-enforced; next it moves into TideCloak multi-party approval so no one can override it.

## Prototype & storytelling

On `#BV-8041` (1/3), **Simulate Rogue Admin** gets only ciphertext. `judge2` signs in, locks, logs out (session revoked); `judge3` signs in and locks. Quorum turns green and **Unlock** reveals the candidate.

<!-- Overview above: ≤ 300 words -->

---

## Table of contents

- [Setup](#setup)
- [Alignment with the challenge brief](#alignment-with-the-challenge-brief)
- [Demo script](#demo-script-2-minutes)
- [Architecture](#architecture)
- [What is real vs. simulated](#what-is-real-vs-simulated)
- [Roadmap](#roadmap)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security note](#security-note)

---

## Setup

**Requirements:** Docker Desktop (recommended) _or_ Node.js 20+.

### Option 1 — Docker Compose (recommended)

```bash
git clone <this-repo-url>
cd RMIT_SGS_404-Brain-not-found_C2
docker compose up --build
```

| Service                 | URL                        | Credentials                            |
| ----------------------- | -------------------------- | -------------------------------------- |
| BlindVault app          | http://localhost:3000      | judge passphrases (below)              |
| TideCloak admin console | http://localhost:8080/auth | `admin` / `password` (local demo only) |

TideCloak (`tideorg/tidecloak-dev`) auto-imports `tidecloak-init/blindvault-realm.json`: realm `blindvault-realm`, client `blindvault-client`, users `judge1`–`judge3`.

### Option 2 — Next.js only

```bash
npm install --legacy-peer-deps   # required: React 19 vs @tidecloak/nextjs peer ranges
npm run dev
```

Without a running TideCloak, the app switches to a clearly labelled fallback mode (see [What is real vs. simulated](#what-is-real-vs-simulated)).

### Judge sign-in (secondary passphrase)

Judges never type the realm password. Each judge has a **secondary passphrase** in `config/judge-credentials.json`:

| Account  | Judge               | Default passphrase — change it |
| -------- | ------------------- | ------------------------------ |
| `judge1` | Dr. Evelyn Vance    | `Vance#BV2026`                 |
| `judge2` | Prof. Marcus Thorne | `Thorne#BV2026`                |
| `judge3` | Dr. Linh Nguyen     | `Linh#BV2026`                  |

Edit and save — the server re-reads the file on every login (Docker mounts it read-only, no rebuild). Once the passphrase matches, the server exchanges it for a TideCloak token using `tidecloakPassword`, which never reaches the browser.

---

## Alignment with the challenge brief

The brief (`context/`) asks for a working prototype with TideCloak integrated that shows **one new possibility**, where **no single administrator, organisation or AI can unilaterally override the rules**. Its golden rule: _"If your app would work exactly the same with ordinary login and backend permissions, develop the idea further."_

| Brief requirement                                  | How BlindVault answers it                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick a possibility held back by a trust trade-off  | Fair, blind evaluation (the _Blind Portfolio Review_ idea) is held back because the platform operator can always see identities.                                                         |
| No single party can override the rules             | The server stores only ciphertext and never holds a decryption key; unmasking needs the judge's own Tide identity **and** a full 3/3 quorum.                                             |
| TideCloak must change what the app can credibly do | With plain RBAC + a DB, an admin can read the identity column at any time. With TideCloak E2EE, the _operator cannot_, which is what makes a publishable "nobody peeked" claim credible. |
| Use synthetic data / mocks                         | All candidates, judges and scores are synthetic.                                                                                                                                         |
| Focus on one convincing demonstration              | One flow: seal → lock scores → quorum → unmask, plus a Rogue Admin attack.                                                                                                               |

### Judging criteria map

| Criterion (weight)             | Where to look                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Vision & originality (25%)     | Blindness as a _property of the data_, not a policy promise                                           |
| Trust constraint insight (20%) | Rogue Admin button returns `ACCESS_DENIED_NO_MASTER_KEY` + raw ciphertext                             |
| Value & impact (20%)           | Scholarships, grants, hiring: verifiable fairness plus an audit trail                                 |
| Why TideCloak matters (20%)    | `lib/tideBridge.ts` (`doEncrypt`/`doDecrypt`), [integration plan](docs/TIDECLOAK_INTEGRATION_PLAN.md) |
| Prototype & storytelling (15%) | The four-act demo below                                                                               |

---

## Architecture

```text
Candidate browser
  └─ sealCandidateIdentity() → TideCloak doEncrypt([{ data, tags: ['message'] }])
        │  only ciphertext leaves the browser
        ▼
/api/submissions  (stores ciphertext + anonymous code + 3 judge slots, no key)
        │
        ├─ Judge signs in: passphrase → /api/tidecloak-auth → TideCloak /token
        ├─ Judge locks score: LOCK_JUDGE_SCORE (score, feedback, signature hash)
        │
        ├─ Unlock at < 3/3  → ERR_EMERGENT_QUORUM_NOT_MET (ciphertext only)
        └─ Unlock at   3/3  → unmaskCandidateIdentity() → TideCloak doDecrypt()
```

### Access policy

| Action          | Who TideCloak lets through                                       |
| --------------- | ---------------------------------------------------------------- |
| Lock a score    | Signed-in `committee_judge`, own slot only                       |
| Unmask identity | Judge with `_tide_message.selfdecrypt` **and** 3/3 scores locked |
| Admin DB dump   | Nobody gets plaintext — ciphertext only                          |

Try it: while signed in as `judge3`, switch the grading slot to Dr. Vance and lock — the server answers `403 NOT_SLOT_OWNER`.

### API reference

**`/api/tidecloak-auth`** — server-side proxy to `…/realms/blindvault-realm/protocol/openid-connect` (avoids browser CORS; tries both `/auth/realms` and `/realms`).

| Action             | TideCloak endpoint       | Purpose                                                        |
| ------------------ | ------------------------ | -------------------------------------------------------------- |
| `TOKEN_PASSWORD`   | `POST /token`            | Verify secondary passphrase, then issue access + refresh token |
| `TOKEN_REFRESH`    | `POST /token`            | Rotate tokens (rejected after logout)                          |
| `TOKEN_INTROSPECT` | `POST /token/introspect` | Show `active`, `sub`, realm roles                              |
| `USERINFO`         | `GET /userinfo`          | Verified judge profile                                         |
| `LOGOUT`           | `POST /logout`           | End session; old tokens then introspect as `active=false`      |

**`/api/submissions`** — `GET` returns the queue; `POST` supports `CREATE_SUBMISSION`, `LOCK_JUDGE_SCORE` and `RESET_DEMO`.

See **[docs/TIDECLOAK_INTEGRATION_PLAN.md](docs/TIDECLOAK_INTEGRATION_PLAN.md)** for the trust map, the 7 TideCloak touchpoints and what each simulated piece is swapped for.

---

## What is real vs. simulated

We would rather be precise than impressive.

| Capability                                                    | Status in this prototype                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TideCloak realm, roles, OIDC login/introspect/userinfo/logout | **Real** when the TideCloak container is up                                                                                                                  |
| Identity encryption with `doEncrypt` / `doDecrypt`            | **Real** only with an activated Tide enclave session (browser sign-in)                                                                                       |
| Fallback "Simulated Envelope"                                 | **Placeholder, not encryption** — a reversible encoding used only so the UI works without an enclave. Labelled `TideCloak-Simulated-Envelope` in the app     |
| Server access checks                                          | **Simulated TideCloak** — `lib/tideSim.ts` checks token, roles, slot ownership and quorum on every protected API call; token signature/DPoP not yet verified |
| 3-of-3 quorum                                                 | Enforced server-side by `checkAccess('UNMASK_IDENTITY')`, not yet cryptographically                                                                          |
| Rogue Admin button                                            | A scripted simulation of the attack, not a live exploit                                                                                                      |
| Logout revocation in fallback mode                            | Simulated with an in-memory revocation list                                                                                                                  |
| Storage                                                       | In-memory; resets on restart                                                                                                                                 |
| Seed data                                                     | Synthetic — no real people                                                                                                                                   |

---

## Roadmap

1. **Live Tide enclave** — activate the realm's Tide license so every submission uses real threshold encryption.
2. **Quorum inside TideCloak** — replace the app-level 3/3 check with a TideCloak multi-approval change request, so decrypt authority is granted only when all three judges approve.
3. **Persistent zero-knowledge store** — PostgreSQL with a raw SQL dump view that proves no plaintext identity is stored.
4. **Anti-anchoring** — encrypt each judge's notes so other judges can read them only after submitting their own score.

---

## Project structure

```text
app/page.tsx                          Main UI: queue, grading console, token inspector, rogue admin
app/api/tidecloak-auth/route.ts       OIDC proxy + passphrase check + logout revocation
app/api/submissions/route.ts          In-memory ciphertext store and quorum state
components/TideClientWrapper.tsx      TideCloak provider wrapper
lib/tideBridge.ts                     doEncrypt/doDecrypt bridge with labelled fallback
lib/tideSim.ts                        Simulated TideCloak access checks (policy table)
config/judge-credentials.json         Judge secondary passphrases
tidecloak-init/blindvault-realm.json  Auto-imported realm, client, roles, judges
docs/TIDECLOAK_INTEGRATION_PLAN.md    Trust map, touchpoints, swap plan
docker-compose.yml                    TideCloak (8080) + Next.js (3000)
```

**Tech stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, `@tidecloak/nextjs`, TideCloak (`tideorg/tidecloak-dev`), Docker Compose.

---

## Troubleshooting

- **TideCloak restarts in a loop (`AccessDeniedException` on H2):** never mount a volume over `/opt/keycloak/data/h2`. Run `docker compose down -v` and start again.
- **`ERESOLVE` on install:** use `npm install --legacy-peer-deps`.
- **Login returns 503:** `config/judge-credentials.json` is missing or invalid JSON.

## Security note

All credentials in this repository (`client_secret`, admin and judge passwords, passphrases) are local demo values for synthetic data. Change them before any real use. Real secrets belong in an untracked `.env`.
