import { tryForceApprove } from "@/lib/server/kcAdmin";
import { audit } from "@/lib/server/store";
import { operatorEnabled } from "../guard";

// The operator tries to push a change request through on its own. Expected: refused, because in
// Tide MultiAdmin mode approval needs an enclave signature from a tide-realm-admin.
export async function POST(req: Request) {
  if (!operatorEnabled()) return Response.json({ error: "operator console disabled" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (!b?.changeRequestId) return Response.json({ error: "changeRequestId required" }, { status: 400 });
  try {
    const out = await tryForceApprove(String(b.changeRequestId));
    audit("operator", "operator", `Operator tried to force-approve ${b.changeRequestId}`,
      `authorize ${out.authorize.status}, approve ${out.approve.status}, commit ${out.commit.status}`);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
