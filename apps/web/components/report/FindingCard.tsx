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

// Severity wins for critical/high/medium; otherwise the marker follows
// direction (legit/unverifiable). A suspicious finding with no severity
// (or low/info) still reads as suspicious.
function severityMarker(finding: FindingVM): SeverityMarker {
  const { severity, direction } = finding;
  if (severity === "critical") return { color: "var(--color-critical)", dataSeverity: "critical" };
  if (severity === "high" || severity === "medium") {
    return { color: "var(--color-suspicious)", dataSeverity: severity };
  }
  if (direction === "legitimizing") return { color: "var(--color-legit)", dataSeverity: "legit" };
  if (direction === "unverifiable") return { color: "var(--color-muted)", dataSeverity: "unverified" };
  return { color: "var(--color-suspicious)", dataSeverity: severity ?? "info" };
}

interface RowTone {
  tone: "critical" | "neutral" | "default";
  background: string | undefined;
}

// Product rule #6: unverifiable must read neutral, never like a warning —
// light-grey row, not an alarm color.
function rowTone(finding: FindingVM): RowTone {
  if (finding.severity === "critical") return { tone: "critical", background: "var(--color-critical-tint)" };
  if (finding.direction === "unverifiable") return { tone: "neutral", background: "var(--color-neutral-row)" };
  return { tone: "default", background: undefined };
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
      className="rounded-none hover:bg-surface-soft"
      style={{ background: row.background }}
    >
      <div className="grid grid-cols-[54px_6px_1fr_26px] items-start gap-3 py-3">
        <div className="pt-1 font-mono text-[12px]">{finding.recordId}</div>
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
          aria-controls={expandId}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-none border border-ink text-[14px] leading-none"
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
            className="pl-[74px] pb-4"
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
