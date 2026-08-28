import { markExported } from "./actions";
import type { PendingResult } from "./export";
import { MarkExportedButton } from "./MarkExportedButton";

// The eval export handoff, as the operator sees it. Production Postgres is on an
// internal network with no route from a laptop, so the candidates cross as a
// file: download here → merge locally → PR → come back and drain the queue.
//
// The step order is printed on the page on purpose. Marking exported before the
// PR merges strands those candidates: they are never offered again, and their
// cases exist nowhere.
export function EvalExport({ result }: { result: PendingResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className="border border-critical-rule bg-critical-tint p-4 font-mono text-[12px] text-critical">
        Read failed — the export queue could not be loaded, so this is NOT necessarily empty. {result.error}
      </p>
    );
  }

  const n = result.candidates.length;
  if (n === 0) {
    return <p className="text-[13px] text-muted">No candidates awaiting export. Promote feedback above to queue one.</p>;
  }

  return (
    <div className="border border-rule-soft">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule-soft bg-surface-soft px-6 py-4">
        <p className="font-mono text-[12px] text-secondary">
          {n} {n === 1 ? "candidate" : "candidates"} awaiting export
        </p>
        <a
          href="/admin/export"
          download
          className="border border-ink px-3 py-1 text-[12px] transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:bg-ink hover:text-page"
        >
          Download {n === 1 ? "candidate" : "candidates"}
        </a>
      </div>

      <ol className="border-b border-rule-soft px-6 py-5 text-[13px] leading-relaxed text-secondary">
        <li>
          <span className="font-mono text-[11px] text-muted">1 </span>
          Download the file above.
        </li>
        <li className="mt-2">
          <span className="font-mono text-[11px] text-muted">2 </span>
          Merge it into the dataset locally:{" "}
          <code className="font-mono text-[12px] text-ink">
            cd apps/api &amp;&amp; uv run scripts/promote_feedback.py --from-file &lt;path&gt;
          </code>
        </li>
        <li className="mt-2">
          <span className="font-mono text-[11px] text-muted">3 </span>
          Review <code className="font-mono text-[12px] text-ink">git diff apps/api/eval/dataset.json</code> and open a pull
          request.
        </li>
        <li className="mt-2">
          <span className="font-mono text-[11px] text-muted">4 </span>
          <strong className="font-semibold text-ink">After the pull request merges</strong>, paste the ids that script printed
          below. Doing this earlier strands those candidates — they are never offered again.
        </li>
      </ol>

      <form action={markExported} className="px-6 py-5">
        <label htmlFor="candidate-ids" className="block font-mono text-[11px] uppercase tracking-wide text-muted">
          Candidate ids
        </label>
        <textarea
          id="candidate-ids"
          name="candidate_ids"
          rows={3}
          required
          placeholder="11111111-1111-1111-1111-111111111111,22222222-…"
          aria-describedby="candidate-ids-hint"
          className="mt-2 w-full border border-rule-strong bg-page p-2 font-mono text-[12px] placeholder:text-faint"
        />
        <p id="candidate-ids-hint" className="mt-2 font-mono text-[11px] text-faint">
          Comma- or whitespace-separated. A malformed id is rejected outright, never skipped.
        </p>
        <div className="mt-3">
          <MarkExportedButton />
        </div>
      </form>
    </div>
  );
}
