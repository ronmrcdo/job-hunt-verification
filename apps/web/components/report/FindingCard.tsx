"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FindingVM } from "../../lib/report-view-model";
import { useMotion } from "../../lib/motion";
import { MicroLabel } from "../ui/MicroLabel";
import { SourceList } from "./SourceList";

export interface FindingCardProps {
  finding: FindingVM;
}

interface SeverityMarker {
  color: string;
  dataSeverity: "critical" | "high" | "medium" | "legit" | "unverified" | "low" | "info";
}

// Critical severity always wins (it must read as critical regardless of
// direction). Below that, product rule #6 requires the unverifiable group to
// read as visually NEUTRAL — grey marker, never a warning — so direction ===
// "unverifiable" wins next, overriding a high/medium severity that would
// otherwise paint the marker orange. Only once neither of those applies does
// severity (high/medium) drive the marker; otherwise it follows direction
// (legit) or defaults to suspicious.
function severityMarker(finding: FindingVM): SeverityMarker {
  const { severity, direction } = finding;
  if (severity === "critical") return { color: "var(--color-critical)", dataSeverity: "critical" };
  if (direction === "unverifiable") return { color: "var(--color-muted)", dataSeverity: "unverified" };
  if (severity === "high" || severity === "medium") {
    return { color: "var(--color-suspicious)", dataSeverity: severity };
  }
  if (direction === "legitimizing") return { color: "var(--color-legit)", dataSeverity: "legit" };
  return { color: "var(--color-suspicious)", dataSeverity: severity ?? "info" };
}

interface RowTone {
  tone: "critical" | "neutral" | "default";
  // Resting background as a Tailwind class rather than an inline style —
  // an inline `style.background` wins over `hover:bg-surface-soft`
  // regardless of source order, which silently killed hover feedback on
  // tinted rows. A class lets the cascade (hover variant ordered after
  // the plain utility) decide instead.
  backgroundClass: string;
}

// Product rule #6: unverifiable must read neutral, never like a warning —
// light-grey row, not an alarm color.
function rowTone(finding: FindingVM): RowTone {
  if (finding.severity === "critical") return { tone: "critical", backgroundClass: "bg-critical-tint" };
  if (finding.direction === "unverifiable") return { tone: "neutral", backgroundClass: "bg-neutral-row" };
  return { tone: "default", backgroundClass: "" };
}

export function FindingCard({ finding }: FindingCardProps) {
  const [open, setOpen] = useState(false);
  const expandId = useId();
  const { expandVariants, expand } = useMotion();

  const marker = severityMarker(finding);
  const row = rowTone(finding);
  const isUnverifiable = finding.direction === "unverifiable";
  const claimWeight = isUnverifiable ? 500 : 700;

  return (
    <div
      data-row-tone={row.tone}
      className={["rounded-none hover:bg-surface-soft", row.backgroundClass].filter(Boolean).join(" ")}
    >
      <div className="grid grid-cols-[54px_6px_1fr_26px] items-start gap-3 py-3 max-[430px]:grid-cols-[6px_1fr_44px]">
        <div data-mobile-hide-recordid className="pt-1 font-mono text-[12px] max-[430px]:hidden">
          {finding.recordId}
        </div>
        <div
          data-severity={marker.dataSeverity}
          className="h-5 w-[6px] rounded-none"
          style={{ background: marker.color }}
        />
        <div>
          <div
            data-weight={claimWeight}
            style={{
              fontWeight: claimWeight,
              fontSize: 18,
              color: isUnverifiable ? "var(--color-body)" : undefined,
            }}
          >
            {finding.claim}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.1em] text-muted">{finding.metaLine}</div>
          {finding.provenanceLabel && (
            // Product rule #5: always visible, never gated behind expand.
            <div className="mt-2 rounded-none border border-rule bg-page p-2 text-[12px] leading-[1.5]">
              {finding.provenanceLabel}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-expanded={open}
          // Only reference the expanded region's id while it's mounted —
          // AnimatePresence unmounts it on collapse, so aria-controls would
          // otherwise point at a nonexistent element.
          aria-controls={open ? expandId : undefined}
          aria-label={open ? "Collapse details" : "Expand details"}
          onClick={() => setOpen((current) => !current)}
          // A constantly-pressed control must feel it heard the press: subtle
          // scale-down on :active + a hover tint, on the shared strong ease-out
          // (transform only — off the main thread, no layout).
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-none border border-ink text-[14px] leading-none transition-[transform,background-color] duration-100 [transition-timing-function:var(--ease-out)] hover:bg-surface-soft active:scale-[0.95] max-[430px]:h-11 max-[430px]:w-11"
        >
          {open ? "−" : "+"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.section
            id={expandId}
            key="expanded"
            initial="collapsed"
            animate="open"
            exit="collapsed"
            variants={expandVariants}
            transition={expand}
            style={{ overflow: "hidden" }}
            className="pl-[74px] pb-4 max-[430px]:pl-[20px]"
          >
            <SourceList sources={finding.sources} />
            {finding.however && (
              <div className="mt-3 rounded-none bg-surface-soft p-3">
                <MicroLabel>HOWEVER</MicroLabel>
                <p className="mt-1 text-[13px] leading-[1.5]">{finding.however}</p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
