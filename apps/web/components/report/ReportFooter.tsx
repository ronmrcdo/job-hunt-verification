"use client";

// Bottom-of-report controls: a quiet issue-report link, the "start over"
// action, the case stamp, and the mandatory non-legal-determination scope
// note (product rule #7: buttons describe what happens, never "Submit").
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReportVM } from "../../lib/report-view-model";
import { formatCaseStamp } from "../../lib/format";
import { useFlow } from "../../lib/flow-context";
import { Button } from "../ui/Button";

export interface ReportFooterProps {
  vm: ReportVM;
  onReport: () => void;
  reported: boolean;
  // No field on ReportVM currently carries a "report generated at" timestamp
  // (the VM's timestamps live per-source, not per-report). Rather than call
  // Date.now()/new Date() at render time — which would make this component
  // non-deterministic under test and on the server — callers may pass the
  // iso explicitly; absent that, a fixed placeholder is used so the stamp is
  // still well-formed and deterministic.
  iso?: string;
}

const PLACEHOLDER_ISO = "2026-08-18T09:41:00Z";

export function ReportFooter({ vm, onReport, reported, iso }: ReportFooterProps) {
  // Seeded from the `reported` prop, then flips true locally on click so a
  // test (or a parent that doesn't re-render with a new prop) still sees the
  // "Thanks" message immediately. onReport is still called so the parent can
  // track/report the real event.
  const [hasReported, setHasReported] = useState(reported);
  const router = useRouter();
  const { reset } = useFlow();

  const handleReport = () => {
    setHasReported(true);
    onReport();
  };

  const handleCheckAnother = () => {
    reset();
    router.push("/");
  };

  return (
    // Aligned flush with the report column above it — a top rule + top padding
    // only, no horizontal padding that would indent it out of line with the
    // summary/findings (Investigator Prototype.dc.html line 403: border-top
    // #E8E8E5, padding-top 18px).
    <footer className="border-t border-rule-soft pt-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {hasReported ? (
          <span className="text-[12px] text-muted">Thanks — we&apos;ll look at it</span>
        ) : (
          <button
            type="button"
            onClick={handleReport}
            className="rounded-none text-[12px] uppercase tracking-[0.1em] text-muted"
          >
            REPORT AN ISSUE WITH THIS ASSESSMENT
          </button>
        )}
        <Button variant="secondary" size="wide" onClick={handleCheckAnother}>
          CHECK ANOTHER POSTING
        </Button>
      </div>
      <div className="mt-6 font-mono text-[10px] text-muted">
        {formatCaseStamp(iso ?? PLACEHOLDER_ISO, vm.caseId)}
      </div>
      <p className="mt-2 max-w-[36rem] text-[12px] text-muted">
        This assessment reflects what we could find and verify online. It is not a legal determination.
      </p>
    </footer>
  );
}
