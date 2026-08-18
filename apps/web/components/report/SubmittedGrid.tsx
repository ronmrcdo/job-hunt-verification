import type { ReportVM } from "../../lib/report-view-model";

export interface SubmittedGridProps {
  rows: ReportVM["submitted"];
}

// Rule #4: values here are always plain label/value pairs (Job, Company,
// Recruiter, Email…) never links — no <a href> is created for any of them.
export function SubmittedGrid({ rows }: SubmittedGridProps) {
  if (rows.length === 0) return null;

  return (
    <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      {rows.map((row) => (
        <div key={row.label} data-submitted-row className="contents">
          <dt className="text-page/70 text-[12px] uppercase tracking-[0.1em]">{row.label}</dt>
          <dd className={row.mono ? "font-mono" : undefined} data-mono={row.mono ? "true" : undefined}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
