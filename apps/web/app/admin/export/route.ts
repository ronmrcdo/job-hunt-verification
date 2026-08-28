import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { assertAdmin, AdminAccessError } from "../../../lib/admin/access";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import { loadPendingCandidates, toExportPayload } from "../export";

// Downloads the promoted-but-not-yet-exported candidates as the JSON envelope
// `scripts/promote_feedback.py --from-file` accepts. This is the crossing point
// for the internal-network handoff: the operator's laptop cannot reach
// production Postgres, but it can reach this route through CF Access.
//
// Read-only. Nothing is marked exported here — that happens only after the
// dataset PR merges, via the markExported action.
export async function GET() {
  try {
    await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }

  const result = await loadPendingCandidates(supabaseAdmin);
  if (!result.ok) {
    // A failed read must never be served as a valid empty export: the operator
    // would merge nothing and mark nothing, believing the queue was drained.
    return new Response(`eval export failed — nothing was exported. ${result.error}\n`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const generatedAt = new Date().toISOString();
  return new Response(JSON.stringify(toExportPayload(result.candidates, generatedAt), null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="eval-candidates-${generatedAt.slice(0, 10)}.json"`,
      // Operator data behind CF Access — never let a proxy or the browser keep it.
      "cache-control": "no-store",
    },
  });
}
