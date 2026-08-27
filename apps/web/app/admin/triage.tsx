import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { promote } from "./actions";
import { PromoteButton } from "./PromoteButton";

type FeedbackRow = Database["public"]["Tables"]["feedback"]["Row"];
// Only the columns the queue renders.
type InvSlim = { id: string; submission: unknown; findings: { id: string; claim: string }[] | null };

export interface TriageRow {
  feedback: FeedbackRow;
  investigation: InvSlim | null;
}

// Pure join, newest feedback first (unit-tested without rendering).
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
// A thrown read (network layer) is folded into the same { ok: false } result as
// a resolved { error }, so a failure surfaces the banner rather than blanking.
export async function loadTriage(client: SupabaseClient<Database>): Promise<TriageResult> {
  try {
    const { data: feedback, error: fErr } = await client
      .from("feedback")
      .select("id, investigation_id, user_id, verdict, wrong_finding_id, note, created_at")
      .order("created_at", { ascending: false });
    if (fErr) return { ok: false, error: `feedback read failed: ${fErr.message}` };

    const invIds = [...new Set((feedback ?? []).map((f) => f.investigation_id))];
    const { data: investigations, error: iErr } = await client
      .from("investigations")
      .select("id, submission, findings")
      .in("id", invIds.length ? invIds : ["00000000-0000-0000-0000-000000000000"]);
    if (iErr) return { ok: false, error: `investigations read failed: ${iErr.message}` };

    return { ok: true, rows: toTriageRows((feedback ?? []) as FeedbackRow[], (investigations ?? []) as InvSlim[]) };
  } catch (e) {
    return { ok: false, error: `triage read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Presentational: the console supplies the <section>/<h2> wrapper. Renders the
// read-failure banner, the empty state, or the queue — each row's Promote form.
export function FeedbackTriage({ result }: { result: TriageResult }) {
  if (!result.ok) {
    return (
      <p className="border border-rule-soft bg-red-50 p-4 font-mono text-[12px] text-red-700">
        Read failed — the queue could not be loaded, so this is NOT necessarily empty. {result.error}
      </p>
    );
  }
  if (result.rows.length === 0) {
    return <p className="text-[13px] text-muted">No feedback yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-6">
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
            <PromoteButton />
          </form>
        </li>
      ))}
    </ul>
  );
}
