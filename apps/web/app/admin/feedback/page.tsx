import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin, AdminAccessError } from "../../../lib/admin/access";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import type { Database } from "../../../lib/database.types";
import { promote } from "./actions";

type FeedbackRow = Database["public"]["Tables"]["feedback"]["Row"];
// Only the columns the queue renders.
type InvSlim = { id: string; submission: unknown; assessment: unknown; findings: { id: string; claim: string }[] | null };

export interface TriageRow {
  feedback: FeedbackRow;
  investigation: InvSlim | null;
}

// Pure join, newest feedback first. Kept a top-level export so it's unit-tested
// without rendering the Server Component (spec Testing).
export function toTriageRows(feedback: FeedbackRow[], investigations: InvSlim[]): TriageRow[] {
  const byId = new Map(investigations.map((i) => [i.id, i]));
  return [...feedback]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((f) => ({ feedback: f, investigation: byId.get(f.investigation_id) ?? null }));
}

export type TriageResult =
  | { ok: true; rows: TriageRow[] }
  | { ok: false; error: string };

// Loads the triage queue, keeping a read FAILURE distinct from an empty queue.
// The two Supabase reads previously discarded their `error` field, so a broken
// read (e.g. the self-hosted Kong gateway rejecting the admin_ro JWT — see
// lib/supabase/admin.ts) rendered identically to "no feedback yet": a blank
// list. We now propagate the message so an admin sees WHY it's empty. Kept a
// top-level export taking the client as an arg so it's unit-tested against a
// fake without a live DB (spec Testing).
export async function loadTriage(client: SupabaseClient<Database>): Promise<TriageResult> {
  const { data: feedback, error: fErr } = await client
    .from("feedback")
    .select("id, investigation_id, user_id, verdict, wrong_finding_id, note, created_at")
    .order("created_at", { ascending: false });
  if (fErr) return { ok: false, error: `feedback read failed: ${fErr.message}` };

  const invIds = [...new Set((feedback ?? []).map((f) => f.investigation_id))];
  const { data: investigations, error: iErr } = await client
    .from("investigations")
    .select("id, submission, assessment, findings")
    .in("id", invIds.length ? invIds : ["00000000-0000-0000-0000-000000000000"]);
  if (iErr) return { ok: false, error: `investigations read failed: ${iErr.message}` };

  return { ok: true, rows: toTriageRows((feedback ?? []) as FeedbackRow[], (investigations ?? []) as InvSlim[]) };
}

export default async function AdminFeedbackPage() {
  try {
    await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }

  const result = await loadTriage(supabaseAdmin);

  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <h1 className="text-lg font-semibold">Feedback triage</h1>
      {!result.ok ? (
        <p className="mt-6 border border-rule-soft bg-red-50 p-4 font-mono text-[12px] text-red-700">
          Read failed — the queue could not be loaded, so this is NOT necessarily
          empty. {result.error}
        </p>
      ) : result.rows.length === 0 ? (
        <p className="mt-6 text-[13px] text-muted">No feedback yet.</p>
      ) : (
      <ul className="mt-6 flex flex-col gap-6">
        {result.rows.map(({ feedback: f, investigation: inv }) => (
          <li key={f.id} className="border border-rule-soft p-4">
            <div className="font-mono text-[11px] text-muted">
              {f.verdict} · {f.created_at}
              {f.wrong_finding_id ? ` · finding ${f.wrong_finding_id}` : ""}
            </div>
            {f.note && <p className="mt-2 text-[13px]">{f.note}</p>}
            <pre className="mt-2 overflow-x-auto text-[11px]">{JSON.stringify(inv?.submission ?? {}, null, 2)}</pre>
            <form action={promote} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="investigation_id" value={f.investigation_id} />
              <input type="hidden" name="wrong_finding_id" value={f.wrong_finding_id ?? ""} />
              <label className="text-[12px]">
                expected_max_band
                <select name="expected_max_band" className="ml-1 border border-rule-soft p-1">
                  <option>LOW</option>
                  <option>MODERATE</option>
                  <option>HIGH</option>
                  <option>CRITICAL</option>
                </select>
              </label>
              <label className="text-[12px]">
                tags
                <input name="tags" placeholder="legit, staffing_agency" className="ml-1 border border-rule-soft p-1" />
              </label>
              <button type="submit" className="border border-ink px-3 py-1 text-[12px]">
                Promote
              </button>
            </form>
          </li>
        ))}
      </ul>
      )}
    </main>
  );
}
