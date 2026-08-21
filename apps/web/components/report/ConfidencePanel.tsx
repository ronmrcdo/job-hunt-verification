import type { CompleteReportVM } from "../../lib/report-view-model";
import { MicroLabel } from "../ui/MicroLabel";
import { SegmentBar } from "../ui/SegmentBar";
import { Tooltip } from "../ui/Tooltip";
import { SubmittedGrid } from "./SubmittedGrid";

const CONFIDENCE_EXPLANATION =
  "Confidence reflects how much we could verify — how many sources responded, how directly they addressed the claim, and how much rested on material we can't check independently.";

export interface ConfidencePanelProps {
  // CompleteReportVM (not ReportVM): the compiler enforces that a null
  // confidence can never reach this component, at every call site.
  vm: CompleteReportVM;
}

// Product rule #2: confidence is a distinct concept from the risk band, so
// it gets its own value + tooltip explanation here rather than folding into
// BandBanner's headline. Convey the value as text ("MEDIUM"), never color-only.
export function ConfidencePanel({ vm }: ConfidencePanelProps) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <MicroLabel tone="var(--color-page)">CONFIDENCE</MicroLabel>
        <Tooltip label="Confidence explanation" tone="var(--color-page)">
          {CONFIDENCE_EXPLANATION}
        </Tooltip>
      </div>
      {/* Value and meter sit on one baseline, as in the prototype: the bar
          reads as a qualifier of the word next to it, not as a separate
          full-width element floating under it. */}
      <div className="mt-2 flex items-center gap-4">
        <span className="text-[34px] font-bold uppercase leading-none tracking-tight">
          {vm.confidence.toUpperCase()}
        </span>
        <div className="w-[76px] shrink-0">
          <SegmentBar
            total={3}
            filled={vm.confidenceSegments}
            fillColor="var(--color-page)"
            emptyColor="var(--color-ink-muted)"
          />
        </div>
      </div>
      <p className="mt-4 text-[14px] leading-[1.5] text-page/90">{vm.confidenceNote}</p>
      <SubmittedGrid rows={vm.submitted} />
    </div>
  );
}
