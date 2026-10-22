import { withAuth } from "@/lib/auth/protect";
import { hasRole } from "@/lib/auth/tideJWT";
import { audit, mutate, readStore } from "@/lib/server/store";
import { FOLDERS, ROLES, folderById, isoNow, newId, type StoredDoc } from "@/lib/errand/model";

const who = (jwt: Record<string, unknown>) => String(jwt.preferred_username ?? jwt.sub);

// GET /api/docs?folder=bills
// Deliberately NOT filtered by folder permissions: the server is not trusted for confidentiality,
// so it hands ciphertext to any participant (Maya or the agent). Only the Tide network decides who
// can turn it into plaintext. This is the "even a compromised server" posture, made explicit.
export const GET = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner) && !hasRole(jwt, ROLES.agent)) {
    return Response.json({ error: "Forbidden: not a participant of this vault" }, { status: 403 });
  }
  const folder = new URL(req.url).searchParams.get("folder");
  const docs = readStore().docs.filter((d) => !folder || d.folder === folder);
  return Response.json({ docs });
});

// POST /api/docs  { items: [{ folder, title, ciphertext }] }  — owner only. Ciphertext only.
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, ROLES.owner)) return Response.json({ error: "Forbidden: owner only" }, { status: 403 });
  const body = await req.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  const created: StoredDoc[] = [];
  for (const it of items) {
    const f = folderById(String(it.folder));
    if (!f || typeof it.ciphertext !== "string" || typeof it.title !== "string") {
      return Response.json({ error: "each item needs folder, title, ciphertext" }, { status: 400 });
    }
    created.push({ id: newId("doc"), folder: f.id, recordId: f.recordId, title: it.title, ciphertext: it.ciphertext, createdAt: isoNow() });
  }
  mutate((s) => {
    if (body?.replace) s.docs = s.docs.filter((d) => !created.some((c) => c.folder === d.folder));
    s.docs.push(...created);
  });
  audit(who(jwt), "info", `Stored ${created.length} encrypted documents`, FOLDERS.map((f) => `${f.label}: ${created.filter((c) => c.folder === f.id).length}`).join(", "));
  return Response.json({ created: created.length });
});
