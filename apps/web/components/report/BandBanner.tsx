import type { ReactNode } from "react";
import type { Band, ReportVM } from "../../lib/report-view-model";
import { MicroLabel } from "../ui/MicroLabel";
import { SegmentBar } from "../ui/SegmentBar";

const BAND_TITLE: Record<Band, string> = {
  LOW: "LOW RISK",
  MODERATE: "MODERATE RISK",
  HIGH: "HIGH RISK",
  CRITICAL: "CRITICAL RISK",
};

// Product rule #3: only CRITICAL gets the saturated critical token. HIGH
// must resolve to --color-band-high, never --color-band-critical.
const BAND_COLOR: Record<Band, string> = {
  LOW: "var(--color-band-low)",
  MODERATE: "var(--color-band-moderate)",
  HIGH: "var(--color-band-high)",
  CRITICAL: "var(--color-band-critical)",
};

export interface BandBannerProps {
  vm: ReportVM;
  confidenceSlot?: ReactNode;
}

export function BandBanner({ vm, confidenceSlot }: BandBannerProps) {
  return (
    <section className="bg-ink text-page">
      <div className="mx-auto max-w-[1240px] grid grid-cols-1 gap-8 px-6 py-16 md:grid-cols-2">
        <div className="max-[430px]:order-2">
          <MicroLabel tone="var(--color-page)">
            {`BAND ${vm.bandIndex} OF 4 · CASE ${vm.caseId}`}
          </MicroLabel>
          <h1 className="mt-4 text-[68px] font-bold uppercase leading-[0.95] tracking-tight">
            {BAND_TITLE[vm.band]}
          </h1>
          <div className="mt-6 max-w-[24rem]">
            <SegmentBar
              total={4}
              filled={vm.bandIndex}
              fillColor={BAND_COLOR[vm.band]}
              emptyColor="var(--color-ink-muted)"
            />
          </div>
          <p className="mt-6 max-w-[36rem] text-page/90">{vm.bandMeaning}</p>
          <hr className="my-6 max-w-[36rem] border-t border-ink-muted" />
          <MicroLabel tone="var(--color-page)">{vm.repeatLine}</MicroLabel>
        </div>
        <div data-mobile-order="above" className="max-[430px]:order-1 max-[430px]:text-right">
          {confidenceSlot}
        </div>
      </div>
    </section>
  );
}
