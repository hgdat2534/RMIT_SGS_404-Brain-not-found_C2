import { readStore } from "@/lib/server/store";
import { POLICY_PLAN } from "@/lib/errand/model";

// Public, non-sensitive setup status (counts only) so the home page can guide first-time setup.
export async function GET() {
  const s = readStore();
  return Response.json({
    policiesSigned: s.policies.length,
    policiesPlanned: POLICY_PLAN.length,
    docs: s.docs.length,
    pendingRequests: s.requests.filter((r) => r.status === "pending").length,
  });
}
