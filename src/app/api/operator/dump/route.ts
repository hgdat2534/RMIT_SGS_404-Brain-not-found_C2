import { readStore } from "@/lib/server/store";
import { listPending, realmInfo } from "@/lib/server/kcAdmin";
import { operatorEnabled } from "../guard";

// Everything the app server holds. The operator console shows it raw: ciphertext, public policy
// bytes, requests, audit. There is no plaintext and no key here to show.
export async function GET() {
  if (!operatorEnabled()) return Response.json({ error: "operator console disabled" }, { status: 404 });
  const s = readStore();
  let pending: unknown[] = [];
  let realm: unknown = null;
  try { pending = await listPending(); realm = await realmInfo(); } catch (e) { pending = [{ error: String(e) }]; }
  return Response.json({ ...s, pendingChangeRequests: pending, realm });
}
