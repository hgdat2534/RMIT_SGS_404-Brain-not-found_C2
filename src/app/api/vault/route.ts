import { withAuth } from "@/lib/auth/middleware";
import { FOLDERS, isFolderId } from "@/lib/domain/folders";
import { badRequest, callerOf, forbidden, readJson } from "@/lib/server/caller";
import { getStore } from "@/lib/server/store";

const MAX_DOCS = 20;
const MAX_CIPHERTEXT = 200_000;

// GET /api/vault             - folder list with counts
// GET /api/vault?folder=bills - that folder's ciphertext and its signed policies
//
// Deliberately NOT gated by folder: any signed-in caller gets the ciphertext and every policy.
// The server cannot decrypt anything and is not the gatekeeper - the Tide network is. Handing a
// hijacked agent the Medical ciphertext is exactly how the demo shows the network refusing it.
export const GET = withAuth(async (req) => {
  const store = getStore();
  const folder = req.nextUrl.searchParams.get("folder");

  if (!folder) {
    return Response.json({
      folders: FOLDERS.map((f) => ({
        ...f,
        documentCount: store.listDocuments(f.id).length,
        policyRoles: store.listPolicies(f.id).map((p) => p.subjectRole),
      })),
    });
  }
  if (!isFolderId(folder)) return badRequest("Unknown folder");

  return Response.json({
    folder: FOLDERS.find((f) => f.id === folder),
    documents: store.listDocuments(folder),
    policies: store.listPolicies(folder),
  });
});

// POST /api/vault { folderId, ciphertexts: string[] } - owner only. Replaces the folder's
// contents with documents the owner encrypted in her browser.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerOf(jwt);
  if (!caller.isOwner) return forbidden("Only the vault owner can write documents");

  const body = await readJson(req);
  if (!body || !isFolderId(body.folderId)) return badRequest("folderId must be bills, medical or id");
  const ciphertexts = body.ciphertexts;
  if (!Array.isArray(ciphertexts) || ciphertexts.length === 0 || ciphertexts.length > MAX_DOCS) {
    return badRequest(`ciphertexts must be an array of 1-${MAX_DOCS} strings`);
  }
  if (!ciphertexts.every((c) => typeof c === "string" && c.length > 0 && c.length <= MAX_CIPHERTEXT)) {
    return badRequest("every ciphertext must be a non-empty string");
  }

  const store = getStore();
  const documents = store.replaceFolder(body.folderId, ciphertexts as string[]);
  store.addAudit({
    actor: caller.name,
    action: "store ciphertext",
    folderId: body.folderId,
    outcome: "info",
    detail: `${documents.length} document(s) encrypted in the owner's browser and stored as ciphertext.`,
  });
  return Response.json({ documents }, { status: 201 });
});
