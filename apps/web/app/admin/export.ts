import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";

// Eval export handoff. Production Postgres is on an internal Coolify network
// with no route from an operator laptop, so promoted candidates leave through
// /admin as a JSON download rather than over a DB connection:
//
//   /admin → download → `promote_feedback.py --from-file` → PR → merge
//          → paste the ids back into /admin → marked exported
//
// This module owns the two ends the web app is responsible for. The dataset
// case SHAPE is deliberately not here — that stays the Python script's single
// definition, so the two languages can't drift. The download is raw rows.

export class ExportError extends Error {}

// Exactly the columns scripts/promote_feedback.py's `candidate_to_case` reads.
const EXPORT_COLUMNS = "id, investigation_id, submission_snapshot, expected_max_band, expected_band, tags";

type CandidateRow = Database["public"]["Tables"]["eval_candidate"]["Row"];
export type PendingCandidate = Pick<
  CandidateRow,
  "id" | "investigation_id" | "submission_snapshot" | "expected_max_band" | "expected_band" | "tags"
>;

export type PendingResult =
  | { ok: true; candidates: PendingCandidate[] }
  | { ok: false; error: string };

// Same failure discipline as loadTriage: a broken read must never render as an
// empty queue, or the operator concludes there is nothing left to export.
export async function loadPendingCandidates(client: SupabaseClient<Database>): Promise<PendingResult> {
  try {
    const { data, error } = await client.from("eval_candidate").select(EXPORT_COLUMNS).eq("status", "promoted");
    if (error) return { ok: false, error: `eval_candidate read failed: ${error.message}` };
    return { ok: true, candidates: (data ?? []) as PendingCandidate[] };
  } catch (e) {
    return { ok: false, error: `eval_candidate read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// The envelope `load_candidates()` in promote_feedback.py accepts. generated_at
// is provenance only — the script ignores it.
export function toExportPayload(candidates: PendingCandidate[], generatedAt: string) {
  return { generated_at: generatedAt, candidates };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parses the comma-separated line the promote script prints. Splits on commas
// AND whitespace so a wrapped terminal paste still works, and de-duplicates.
//
// Throws on a malformed token rather than skipping it: a silently dropped id
// leaves that candidate stuck as 'promoted' forever while the operator believes
// it was marked — the one failure this whole handoff exists to avoid.
export function parseCandidateIds(raw: string): string[] {
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) throw new ExportError("no candidate ids given");
  const bad = tokens.filter((t) => !UUID.test(t));
  if (bad.length) throw new ExportError(`not candidate ids: ${bad.join(", ")}`);
  return [...new Set(tokens)];
}
