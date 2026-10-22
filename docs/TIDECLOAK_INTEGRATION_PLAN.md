# Where TideCloak fits in BlindVault

BlindVault is built as if TideCloak protects it. Sign-in, roles and access checks are **simulated** today behind the same seams a live TideCloak integration would use, so swapping in the real thing changes the plumbing, not the app.

> Planning note: Tide's MCP (`mcp.tide.org/mcp`) was not connected in our build environment. This plan follows the Tide MCP guidance captured from the official UNLOCKED developer walkthrough (built-in vs custom work, the 10 gotchas).

## 1. Trust map — who could cheat in an ordinary portal

| Actor | Ordinary portal | BlindVault target with TideCloak |
|---|---|---|
| DB / root admin | Joins `submissions` ⨝ `identities` any time | Holds ciphertext only; no key on the server |
| Committee chair | Can unmask early via admin panel | Needs the same 3/3 quorum as everyone |
| One judge | Can peek before scoring | Can only lock *their own* slot; cannot decrypt alone |
| Compromised server | Leaks all identities | Leaks ciphertext; decrypt needs Tide's threshold network |

## 2. TideCloak touchpoints

| # | Touchpoint | TideCloak feature | Simulated today in | Live swap |
|---|---|---|---|---|
| 1 | Judge sign-in | Tide account sign-in in the browser (no password) | `/api/tidecloak-auth` passphrase → realm token | `@tidecloak/nextjs` browser sign-in; delete passphrase file |
| 2 | Roles in token | Threshold-signed (EdDSA) token with realm roles | Keycloak/fallback JWT with `committee_judge`, `_tide_message.*` | Same role names in the Tide realm |
| 3 | Server access checks | Verify token + DPoP on every request | `lib/tideSim.ts` → `checkAccess()` (signature not verified) | Replace `decodeClaims()` with Tide token + DPoP verification |
| 4 | Secure fetch | Tide SDK secure fetch (plain fetch → 401) | `secureSubmissionsPost()` adds Bearer token, auto-refresh | Swap for SDK secure fetch |
| 5 | Identity sealing | Tag-based E2EE `doEncrypt` (tag `message`) | `lib/tideBridge.ts` (labelled placeholder envelope fallback) | Activate Tide enclave license on the realm |
| 6 | 3/3 unmask quorum | IGA multi-approval / policy so decrypt authority emerges only after all judges approve | `checkAccess('UNMASK_IDENTITY')` + quorum count | Each judge's lock = approval on a TideCloak change request |
| 7 | Logout / revocation | Session end; removal applies on next refresh | In-memory revocation list | TideCloak session logout |

## 3. Access policy (`lib/tideSim.ts → POLICY`)

| Action | Required roles | Extra rule | Denial codes |
|---|---|---|---|
| `CREATE_SUBMISSION` | — (candidate) | Identity sealed in browser | — |
| `LOCK_JUDGE_SCORE` | `committee_judge` | Token username must own the slot (`judge3` → `judge-3`) | `NO_TOKEN`, `TOKEN_REVOKED`, `TOKEN_EXPIRED`, `MISSING_ROLE`, `NOT_SLOT_OWNER` |
| `UNMASK_IDENTITY` | `committee_judge`, `_tide_message.selfdecrypt` | All judges locked (3/3) | … + `QUORUM_NOT_MET` |
| `ADMIN_RAW_DUMP` | `platform_admin` | Returns ciphertext only, ever | `NO_TOKEN`, `MISSING_ROLE` |

Verified cases: own slot → allow; other slot → 403; no token → 401; missing role → 403; expired → 401; unmask at 2/3 → 403; unmask at 3/3 → allow; admin dump without token → 401; any call after logout → 401.

## 4. Built-in vs custom work (live integration)

- **Built in:** sign-in, roles in token, server-side checks, tag-based encryption, IGA approvals for role changes, logout.
- **Custom:** binding "3 locked scores" to decrypt authority. Best fit: one TideCloak change request per submission that grants `_tide_message.selfdecrypt` for that record only after all three judges approve. If the built-in policy can't express "all three judges of *this* submission", a custom contract would be needed (Tide-reviewed, test network).

## 5. Gotchas we design around

- Server checks on every request, not hidden buttons (gotcha 7).
- Calls to our API go through secure fetch (gotcha 5).
- Tide tokens are EdDSA — pick a verifier that supports it before going live (gotcha 6).
- New Tide accounts have no name/email — add a short judge profile form (gotcha 9).
- Role removal applies on next refresh — logout/login to demo it (gotcha 10).
