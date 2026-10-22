// The demo's cast: who has an account in the realm, which roles TideCloak gives them at the start,
// and - in plain words - what that lets them do. The simulated realm seeds its users from this list,
// and the home, sign-in and "How it works" pages explain the roles from it. Browser-safe.

import {
  ADMIN_ROLE,
  AGENT_ROLE,
  AUDITOR_ROLE,
  DECRYPTOR_ROLE,
  ENCRYPTOR_ROLE,
  HOUSEHOLD_ROLE,
  OWNER_ROLE,
  SUPPORT_ROLE,
  getFolder,
} from "./folders";

export interface Person {
  username: string;
  name: string;
  title: string;
  summary: string;
  /** Realm roles at the start of the demo. Folder roles for the agent come later, by change request. */
  realmRoles: string[];
  /** Client roles, by client (tide-realm-admin lives on realm-management). */
  clientRoles: Record<string, string[]>;
  /** Where this person starts after signing in. */
  home: string;
  can: string[];
  cannot: string[];
  /** One of the --person-* colours in globals.css. */
  colour: "owner" | "agent" | "household" | "auditor" | "support";
}

export const AGENT_USERNAME = process.env.ERRAND_AGENT_USERNAME || "errand-agent";

export const PEOPLE: Person[] = [
  {
    username: "maya",
    name: "Maya",
    title: "Vault owner",
    summary: "Owns the documents. The only person who can approve who opens what.",
    realmRoles: [OWNER_ROLE, ENCRYPTOR_ROLE, DECRYPTOR_ROLE],
    clientRoles: { "realm-management": [ADMIN_ROLE] },
    home: "/owner",
    can: ["Read and write every folder", "Approve or deny every access request", "Grant and revoke the agent's folders"],
    cannot: ["Be impersonated by the server: approvals need her own signed-in session"],
    colour: "owner",
  },
  {
    username: AGENT_USERNAME,
    name: "Errand",
    title: "AI agent",
    summary: "Sorts Maya's bills. Has its own account, so it only gets the folders Maya grants it.",
    realmRoles: [AGENT_ROLE, DECRYPTOR_ROLE],
    clientRoles: {},
    home: "/agent",
    can: ["Read a folder once Maya grants it", "Ask Maya for more access"],
    cannot: ["Read anything Maya has not granted", "Approve its own requests", "Write or change documents"],
    colour: "agent",
  },
  {
    username: "sam",
    name: "Sam",
    title: "Household member",
    summary: "Maya's partner. Shares the household bills, and nothing else.",
    realmRoles: [HOUSEHOLD_ROLE, getFolder("bills").householdRole!, DECRYPTOR_ROLE],
    clientRoles: {},
    home: "/access",
    can: ["Read the Bills folder"],
    cannot: ["Read Medical or ID", "Change who has access"],
    colour: "household",
  },
  {
    username: "kim",
    name: "Kim",
    title: "Auditor",
    summary: "Maya's accountant. Checks the activity log, never the documents themselves.",
    realmRoles: [AUDITOR_ROLE],
    clientRoles: {},
    home: "/audit",
    can: ["Read the activity log and the request history"],
    cannot: ["Decrypt any document (no folder role, no decryptor role)", "Approve anything"],
    colour: "auditor",
  },
  {
    username: "alex",
    name: "Alex",
    title: "Platform support engineer",
    summary: "Works for the company that runs Errand. Can see the servers, not inside the vault.",
    realmRoles: [SUPPORT_ROLE],
    clientRoles: {},
    home: "/access",
    can: ["See what the server stores: ciphertext and policies", "File a request, which lands in Maya's queue flagged red"],
    cannot: ["Decrypt any document", "Approve the request he filed"],
    colour: "support",
  },
];

export function findPerson(username: unknown): Person | undefined {
  return PEOPLE.find((p) => p.username === username);
}

/** Roles worth showing a person. `_tide_*` stays: it is half of what decides a decrypt. */
export function visibleRoles(roles: string[]): string[] {
  return roles.filter((r) => !r.startsWith("default-roles"));
}
