import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin, AdminAccessError } from "../../lib/admin/access";
import { supabaseAdmin } from "../../lib/supabase/admin";
import type { Database } from "../../lib/database.types";
import { toDashboardStats, type DashboardStats } from "./stats";
import { loadTriage, FeedbackTriage, toPromotionIndex, type TriageResult, type PromotionIndex } from "./triage";
import { loadPendingCandidates, loadAllCandidates, type PendingResult } from "./export";
import { OverviewGrid } from "./OverviewGrid";
import { EvalExport } from "./EvalExport";

// Each read coalesces its own failure to an empty/zero value (spec Error
// Handling): one broken read shows a 0 card, never throws, never blanks the
// page. The verdict tally is derived from the rows loadTriage already fetched —
// no duplicate feedback query.
export async function loadConsole(
  client: SupabaseClient<Database>,
): Promise<{ stats: DashboardStats; triage: TriageResult; pending: PendingResult; promotions: PromotionIndex | null }> {
  // One eval_candidate read serves both consumers: the Overview's status tally
  // and the queue's per-row promotion badge. `null` = that read failed, which
  // the queue must render as "unknown", never as "nothing promoted".
  const [triage, pending, candidates, investigationsTotal, registeredUsers] = await Promise.all([
    loadTriage(client),
    loadPendingCandidates(client),
    loadAllCandidates(client),
    readInvestigationsCount(client),
    readRegisteredUsers(client),
  ]);
  const feedbackVerdicts = triage.ok ? triage.rows.map((r) => r.feedback.verdict) : [];
  const candidateStatuses = (candidates ?? []).map((c) => c.status);
  const stats = toDashboardStats({ registeredUsers, investigationsTotal, feedbackVerdicts, candidateStatuses });
  return { stats, triage, pending, promotions: candidates ? toPromotionIndex(candidates) : null };
}

// Each helper coalesces BOTH a resolved `{ error }` and a thrown read (network
// layer) to its fallback, so no single failed read can reject Promise.all and
// blank the page.
async function readInvestigationsCount(client: SupabaseClient<Database>): Promise<number> {
  try {
    const { count } = await client.from("investigations").select("*", { head: true, count: "exact" });
    return count ?? 0;
  } catch {
    return 0;
  }
}
async function readRegisteredUsers(client: SupabaseClient<Database>): Promise<number> {
  try {
    const { data } = await client.rpc("admin_registered_user_count");
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

export default async function AdminConsolePage() {
  try {
    await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }
  const { stats, triage, pending, promotions } = await loadConsole(supabaseAdmin);
  return (
    <main id="main-content" className="mx-auto max-w-page px-8 py-16 max-[430px]:px-5">
      <h1 className="sr-only">Admin console</h1>
      <section id="overview" className="scroll-mt-[66px]">
        <h2 className="text-lg font-semibold">Overview</h2>
        <p className="mt-1 font-mono text-[12px] text-muted">All-time totals</p>
        <div className="mt-6">
          <OverviewGrid stats={stats} />
        </div>
      </section>
      <section id="feedback" className="mt-16 border-t border-rule-soft pt-16 scroll-mt-[66px]">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <div className="mt-6">
          <FeedbackTriage result={triage} promotions={promotions} />
        </div>
      </section>
      <section id="export" className="mt-16 border-t border-rule-soft pt-16 scroll-mt-[66px]">
        <h2 className="text-lg font-semibold">Eval export</h2>
        <p className="mt-1 font-mono text-[12px] text-muted">Promoted candidates → eval/dataset.json</p>
        <div className="mt-6">
          <EvalExport result={pending} />
        </div>
      </section>
    </main>
  );
}
