import type { ReportVM } from "../../lib/report-view-model";
import { MicroLabel } from "../ui/MicroLabel";

export interface SubmittedGridProps {
  rows: ReportVM["submitted"];
}

// Rule #4: values here are always plain label/value pairs (Company, Email,
// Posting…) never links — no <a href> is created for any of them.
//
// Layout mirrors the prototype: a rule separating this recap from the
// confidence note above it, then a two-up grid with the micro-label stacked
// *above* its value. The previous label-left/value-right grid squeezed long
// values (an email, a URL) into a narrow second column inside a 320px rail.
export function SubmittedGrid({ rows }: SubmittedGridProps) {
  if (rows.length === 0) return null;

  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-ink-muted pt-5">
      {rows.map((row) => (
        <div key={row.label} data-submitted-row className="min-w-0">
          <dt>
            <MicroLabel tone="var(--color-page)" className="opacity-70">
              {row.label.toUpperCase()}
            </MicroLabel>
          </dt>
          {/* break-words, not break-all: a long address or URL wraps at the
              column edge without shredding short values mid-word. */}
          <dd
            className={[
              "mt-1 break-words text-[13px] leading-[1.45]",
              row.mono ? "font-mono" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-mono={row.mono ? "true" : undefined}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
