import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { defang } from "../../lib/defang";
import { pad2 } from "../../lib/format";
import { promote } from "./actions";
import { PromoteButton } from "./PromoteButton";

type FeedbackRow = Database["public"]["Tables"]["feedback"]["Row"];
// Only the columns the queue renders.
type Assessment = { band: string; confidence: string };
type InvSlim = {
  id: string;
  submission: unknown;
  assessment: Assessment | null;
  findings: { id: string; claim: string }[] | null;
};

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
      .select("id, submission, assessment, findings")
      .in("id", invIds.length ? invIds : ["00000000-0000-0000-0000-000000000000"]);
    if (iErr) return { ok: false, error: `investigations read failed: ${iErr.message}` };

    return { ok: true, rows: toTriageRows((feedback ?? []) as FeedbackRow[], (investigations ?? []) as InvSlim[]) };
  } catch (e) {
    return { ok: false, error: `triage read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers — pure, so the table's copy is unit-tested without a DOM.
// ---------------------------------------------------------------------------

type SubmissionSlim = { job_text?: string; company_name?: string; job_url?: string };

// `submission` is jsonb (typed `unknown`): narrow defensively rather than cast,
// so a row written by an older worker can't crash the whole console.
export function asSubmission(value: unknown): SubmissionSlim {
  return value && typeof value === "object" ? (value as SubmissionSlim) : {};
}

// UTC components only, same determinism rule as lib/format's stamps: the
// operator's timestamps must not shift with the server's timezone.
export function formatFeedbackStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const VERDICT_LABELS: Record<string, string> = { agree: "Agree", too_high: "Too high", too_low: "Too low" };

export function verdictLabel(verdict: string): string {
  return VERDICT_LABELS[verdict] ?? verdict;
}

// Tone carries the verdict at a glance, but never alone — the label text is
// always rendered beside it (color-not-only).
const VERDICT_TONE: Record<string, string> = {
  agree: "border-legit text-legit",
  too_high: "border-suspicious text-suspicious",
  too_low: "border-ink-muted text-ink-muted",
};

// The four risk bands, in order — also the promote form's option list, so the
// control can never offer a band the product doesn't define.
const BANDS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;

// Band tone mirrors the report's BandBanner/FourBands mapping. HIGH uses the
// on-white variant so it stays legible on the page ground and can never be
// mistaken for CRITICAL.
const BAND_TONE: Record<string, string> = {
  LOW: "var(--color-band-low)",
  MODERATE: "var(--color-band-moderate)",
  HIGH: "var(--color-band-high-on-white)",
  CRITICAL: "var(--color-band-critical)",
};

const MAX_LABEL = 64;

// What the operator scans first: the company if the posting named one, else the
// opening of the pasted text. Never the URL — that stays defanged below.
export function postingLabel(submission: SubmissionSlim): string {
  const company = submission.company_name?.trim();
  if (company) return company;
  const text = submission.job_text?.trim().split("\n")[0]?.trim();
  if (!text) return "Untitled posting";
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL).trimEnd()}…` : text;
}

// "12 items · 7 agree · 3 too high · 2 too low" — one plain string so the queue
// shape is readable before the eye reaches the first row.
export function summarise(rows: TriageRow[]): string {
  const counts = new Map<string, number>();
  for (const { feedback } of rows) counts.set(feedback.verdict, (counts.get(feedback.verdict) ?? 0) + 1);
  const parts = ["agree", "too_high", "too_low"]
    .filter((v) => counts.get(v))
    .map((v) => `${counts.get(v)} ${verdictLabel(v).toLowerCase()}`);
  const total = `${rows.length} ${rows.length === 1 ? "item" : "items"}`;
  return [total, ...parts].join(" · ");
}

// ---------------------------------------------------------------------------
// Presentational: the console supplies the <section>/<h2> wrapper. Renders the
// read-failure banner, the empty state, or the queue as a scannable table.
// ---------------------------------------------------------------------------

const TH = "px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-wide text-muted";
const TD = "px-4 py-4 align-top";

export function FeedbackTriage({ result }: { result: TriageResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className="border border-critical-rule bg-critical-tint p-4 font-mono text-[12px] text-critical">
        Read failed — the queue could not be loaded, so this is NOT necessarily empty. {result.error}
      </p>
    );
  }
  if (result.rows.length === 0) {
    return <p className="text-[13px] text-muted">No feedback yet.</p>;
  }
  return (
    <div>
      <p className="font-mono text-[12px] text-muted">{summarise(result.rows)}</p>
      {/* Horizontal scroll is confined to this wrapper so the page itself never
          scrolls sideways on a phone (the dense columns need the width). */}
      <div className="mt-4 overflow-x-auto border border-rule-soft">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <caption className="sr-only">Feedback triage queue, newest first</caption>
          <thead>
            <tr className="border-b border-rule-soft bg-surface-soft">
              <th scope="col" className={`${TH} w-[110px]`}>Verdict</th>
              <th scope="col" className={`${TH} w-[150px]`}>Assessed</th>
              <th scope="col" className={`${TH} w-[150px]`}>Received</th>
              <th scope="col" className={TH}>Posting</th>
              <th scope="col" className={TH}>Note</th>
              <th scope="col" className={`${TH} w-[260px]`}>Promote to eval set</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(({ feedback: f, investigation: inv }) => (
              <TriageTableRow key={f.id} feedback={f} investigation={inv} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TriageTableRow({ feedback: f, investigation: inv }: TriageRow) {
  const submission = asSubmission(inv?.submission);
  const flagged = f.wrong_finding_id ? inv?.findings?.find((x) => x.id === f.wrong_finding_id) ?? null : null;
  const assessment = inv?.assessment ?? null;
  const bandId = `band-${f.id}`;
  const tagsId = `tags-${f.id}`;
  return (
    <tr className="border-t border-rule-soft transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:bg-surface-alt">
      <td className={TD}>
        <span className={`inline-block border px-2 py-[3px] font-mono text-[11px] ${VERDICT_TONE[f.verdict] ?? "border-rule-strong text-secondary"}`}>
          {verdictLabel(f.verdict)}
        </span>
      </td>
      <td className={TD}>
        {/* Product rule #2: the band and the confidence are two separate
            values, each labelled — never fused into one grade, never a score. */}
        {assessment ? (
          <>
            <span className="flex items-center gap-2">
              <span className="h-[10px] w-[10px] shrink-0" aria-hidden="true" style={{ background: BAND_TONE[assessment.band] ?? "var(--color-rule-strong)" }} />
              <span className="font-mono text-[12px] font-bold tracking-wide text-ink">{assessment.band}</span>
            </span>
            <span className="mt-2 block font-mono text-[11px] text-muted">
              Confidence {assessment.confidence}
            </span>
          </>
        ) : (
          <span className="font-mono text-[12px] text-faint">Not assessed</span>
        )}
      </td>
      <td className={TD}>
        <time dateTime={f.created_at} title={f.created_at} className="font-mono text-[12px] tabular-nums text-secondary">
          {formatFeedbackStamp(f.created_at)}
        </time>
        <span className="mt-1 block font-mono text-[11px] text-faint">UTC</span>
      </td>
      <td className={`${TD} max-w-[360px]`}>
        <span className="block text-[13px] font-semibold text-ink">{postingLabel(submission)}</span>
        {submission.job_url && (
          // Product rule #4 / spec §9.5: a submitted URL is inert text here too
          // — the admin console is not an exception to "never a live link".
          <span className="mt-1 block break-all font-mono text-[11px] text-muted">{defang(submission.job_url)}</span>
        )}
        {flagged && (
          <span className="mt-2 block border-l-2 border-suspicious pl-2 text-[12px] text-secondary">
            Flagged finding: {flagged.claim}
          </span>
        )}
        {f.wrong_finding_id && !flagged && (
          <span className="mt-2 block font-mono text-[11px] text-faint">Flagged finding {f.wrong_finding_id} (no longer on the investigation)</span>
        )}
        {/* Progressive disclosure: the raw jsonb is still one click away for a
            hard case, but it no longer buries every row in JSON. */}
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[11px] text-muted transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink">
            Raw submission
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto border border-rule-soft bg-surface-soft p-3 text-[11px]">
            {JSON.stringify(inv?.submission ?? {}, null, 2)}
          </pre>
        </details>
      </td>
      <td className={`${TD} max-w-[320px]`}>
        {f.note ? (
          <p className="text-[13px] leading-relaxed text-body">{f.note}</p>
        ) : (
          <span className="font-mono text-[12px] text-faint">— no note</span>
        )}
      </td>
      <td className={TD}>
        <form action={promote} className="flex flex-col gap-2">
          <input type="hidden" name="investigation_id" value={f.investigation_id} />
          <input type="hidden" name="wrong_finding_id" value={f.wrong_finding_id ?? ""} />
          <label htmlFor={bandId} className="font-mono text-[11px] uppercase tracking-wide text-muted">
            Expected max band
          </label>
          {/* Preselected to the band that was actually returned: an "agree"
              verdict is then a single click, and a "too high" verdict starts
              from the value the operator is correcting rather than from an
              arbitrary LOW. */}
          <select
            id={bandId}
            name="expected_max_band"
            defaultValue={assessment && BANDS.includes(assessment.band as (typeof BANDS)[number]) ? assessment.band : "LOW"}
            className="h-9 border border-rule-strong bg-page px-2 text-[13px]"
          >
            {BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <label htmlFor={tagsId} className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">
            Tags
          </label>
          <input
            id={tagsId}
            name="tags"
            placeholder="legit, staffing_agency"
            aria-describedby={`${tagsId}-hint`}
            className="h-9 border border-rule-strong bg-page px-2 text-[13px] placeholder:text-faint"
          />
          <span id={`${tagsId}-hint`} className="font-mono text-[11px] text-faint">
            Comma-separated
          </span>
          <PromoteButton />
        </form>
      </td>
    </tr>
  );
}
