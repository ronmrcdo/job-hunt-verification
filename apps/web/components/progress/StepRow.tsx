"use client";

// One row in the scripted progress list. Rows carry no percentage or
// spinner — the only signal is which state a row is in (queued -> running
// -> done/soft), read off `data-step-state` by tests instead of any class
// name so the visual styling can change freely.
import { useMemo, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { useMotion } from "../../lib/motion";
import type { ProgressStep } from "./progress-script";

export type StepRowState = "done" | "soft" | "running" | "queued";

export interface StepRowProps {
  step: ProgressStep;
  state: StepRowState;
}

const RIGHT_LABEL: Record<StepRowState, string> = {
  done: "Closed",
  soft: "Soft close",
  running: "Open",
  queued: "Queued",
};

function statusSquareStyle(state: StepRowState): CSSProperties {
  switch (state) {
    case "done":
      return { background: "var(--color-ink)", border: "1px solid var(--color-ink)" };
    case "soft":
      return { background: "var(--color-page)", border: "1px solid var(--color-suspicious)" };
    case "running":
      return { background: "var(--color-page)", border: "1px solid var(--color-ink)" };
    case "queued":
      return { background: "var(--color-page)", border: "1px solid var(--color-rule)" };
  }
}

function formatTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StepRow({ step, state }: StepRowProps) {
  const { colorShift } = useMotion();
  // Timestamp is cosmetic (display-only), fixed at the moment this row
  // first renders in a done/soft state rather than recomputed every render.
  const timestamp = useMemo(() => formatTimestamp(), []);

  const col1 = state === "done" || state === "soft" ? timestamp : state === "running" ? "running" : "queued";
  const note = state === "running" && step.runningNote ? step.runningNote : step.note;
  const showNote = state === "done" || state === "soft" || state === "running";

  return (
    <motion.div
      layout
      data-step-state={state}
      animate={{ opacity: 1 }}
      transition={colorShift}
      className="grid grid-cols-[88px_22px_1fr_108px] items-start gap-3 border-t border-rule px-2 py-3"
      style={{ background: state === "running" ? "var(--color-neutral-row)" : undefined }}
    >
      <div className="pt-[3px] font-mono text-[12px] text-muted">{col1}</div>
      <div className="mt-[3px] h-[11px] w-[11px] rounded-none" style={statusSquareStyle(state)} />
      <div>
        <div className="text-[16px] font-bold">{step.title}</div>
        {showNote && <div className="mt-1 text-[13px] leading-[1.5] text-secondary">{note}</div>}
      </div>
      <div
        className="pt-[3px] text-right text-[11px] uppercase tracking-[0.1em]"
        style={{ color: state === "soft" ? "var(--color-suspicious)" : undefined }}
      >
        {RIGHT_LABEL[state]}
      </div>
    </motion.div>
  );
}
