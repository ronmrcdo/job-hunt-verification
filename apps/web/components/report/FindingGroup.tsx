import type { ReportVM } from "../../lib/report-view-model";
import { FindingCard } from "./FindingCard";

export interface FindingGroupProps {
  group: ReportVM["groups"][number];
}

// Product rule #6: the unverifiable group is neutral, not a warning — this
// preamble frames it as open questions rather than accusations.
const UNVERIFIABLE_PREAMBLE =
  "Open questions, not accusations. Each one is a gap in what we could reach.";

export function FindingGroup({ group }: FindingGroupProps) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-rule pb-2">
        <h2 className="text-[11px] uppercase tracking-[0.1em]">{group.heading}</h2>
        <span className="font-mono text-[11px] text-muted">{group.countMono}</span>
      </div>
      {group.key === "unverifiable" && (
        <p className="mt-3 text-[13px] leading-[1.5] text-muted">{UNVERIFIABLE_PREAMBLE}</p>
      )}
      <div>
        {group.findings.map((finding) => (
          <FindingCard key={finding.recordId} finding={finding} />
        ))}
      </div>
    </section>
  );
}
