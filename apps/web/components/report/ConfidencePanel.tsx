import type { ReportVM } from "../../lib/report-view-model";
import { MicroLabel } from "../ui/MicroLabel";
import { SegmentBar } from "../ui/SegmentBar";
import { Tooltip } from "../ui/Tooltip";
import { SubmittedGrid } from "./SubmittedGrid";

const CONFIDENCE_EXPLANATION =
  "Confidence reflects how much we could verify — how many sources responded, how directly they addressed the claim, and how much rested on material we can't check independently.";

export interface ConfidencePanelProps {
  vm: ReportVM;
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
      <div className="mt-2 text-[34px] uppercase leading-none">{vm.confidence.toUpperCase()}</div>
      <div className="mt-4 max-w-[16rem]">
        <SegmentBar
          total={3}
          filled={vm.confidenceSegments}
          fillColor="var(--color-page)"
          emptyColor="var(--color-ink-muted)"
        />
      </div>
      <p className="mt-3 text-page/90">{vm.confidenceNote}</p>
      <SubmittedGrid rows={vm.submitted} />
    </div>
  );
}
