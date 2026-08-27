import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin, AdminAccessError } from "../../lib/admin/access";
import { supabaseAdmin } from "../../lib/supabase/admin";
import type { Database } from "../../lib/database.types";
import { toDashboardStats, type DashboardStats } from "./stats";
import { loadTriage, FeedbackTriage, type TriageResult } from "./triage";
import { OverviewGrid } from "./OverviewGrid";

// Each read coalesces its own failure to an empty/zero value (spec Error
// Handling): one broken read shows a 0 card, never throws, never blanks the
// page. The verdict tally is derived from the rows loadTriage already fetched —
// no duplicate feedback query.
export async function loadConsole(
  client: SupabaseClient<Database>,
): Promise<{ stats: DashboardStats; triage: TriageResult }> {
  const [triage, candidateStatuses, investigationsTotal, registeredUsers] = await Promise.all([
    loadTriage(client),
    readCandidateStatuses(client),
    readInvestigationsCount(client),
    readRegisteredUsers(client),
  ]);
  const feedbackVerdicts = triage.ok ? triage.rows.map((r) => r.feedback.verdict) : [];
  const stats = toDashboardStats({ registeredUsers, investigationsTotal, feedbackVerdicts, candidateStatuses });
  return { stats, triage };
}

async function readCandidateStatuses(client: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await client.from("eval_candidate").select("status");
  return (data ?? []).map((r) => r.status as string);
}
async function readInvestigationsCount(client: SupabaseClient<Database>): Promise<number> {
  const { count } = await client.from("investigations").select("*", { head: true, count: "exact" });
  return count ?? 0;
}
async function readRegisteredUsers(client: SupabaseClient<Database>): Promise<number> {
  const { data } = await client.rpc("admin_registered_user_count");
  return typeof data === "number" ? data : 0;
}

export default async function AdminConsolePage() {
  try {
    await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }
  const { stats, triage } = await loadConsole(supabaseAdmin);
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
          <FeedbackTriage result={triage} />
        </div>
      </section>
    </main>
  );
}
