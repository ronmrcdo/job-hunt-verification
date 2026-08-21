// Bottom-of-report meta strip: the case stamp and the mandatory
// non-legal-determination scope note.
//
// The report-an-issue and check-another controls used to live here as well.
// They now live once, in the sticky ReportRail, which is visible from
// anywhere in a long report — keeping a second copy down here meant two
// controls for each action and two places to keep their wording in sync.
import type { ReportVM } from "../../lib/report-view-model";
import { formatCaseStamp } from "../../lib/format";

export interface ReportFooterProps {
  vm: ReportVM;
  // No field on ReportVM currently carries a "report generated at" timestamp
  // (the VM's timestamps live per-source, not per-report). Rather than call
  // Date.now()/new Date() at render time — which would make this component
  // non-deterministic under test and on the server — callers may pass the
  // iso explicitly; absent that, a fixed placeholder is used so the stamp is
  // still well-formed and deterministic.
  iso?: string;
}

const PLACEHOLDER_ISO = "2026-08-18T09:41:00Z";

export function ReportFooter({ vm, iso }: ReportFooterProps) {
  return (
    // Aligned flush with the report column above it — a top rule + top padding
    // only, no horizontal padding that would indent it out of line with the
    // summary/findings (Investigator Prototype.dc.html line 403: border-top
    // #E8E8E5, padding-top 18px).
    <footer className="border-t border-rule-soft pt-[18px]">
      <div className="font-mono text-[10px] text-muted">
        {formatCaseStamp(iso ?? PLACEHOLDER_ISO, vm.caseId)}
      </div>
      <p className="mt-2 max-w-[36rem] text-[12px] leading-[1.5] text-muted">
        This assessment reflects what we could find and verify online. It is not a legal determination.
      </p>
    </footer>
  );
}
