"use client";

// One row in the scripted progress list. The signal is which state a row is
// in (queued -> running -> done/soft/failed), read off `data-step-state` by
// tests instead of any class name so the visual styling can change freely.
//
// Every per-state colour below is a direct port of the design handoff's
// PROGRESS `renderVals` map (Investigator Prototype.dc.html) — the running
// state is deliberately monochrome (ink, not an accent colour, #FAFAFA row).
//
// The status glyph animates per state (see StepGlyph): running spins, done
// draws a check, failed draws an X. queued/soft keep the handoff's hollow
// square. This is a deliberate extension of the handoff, which only animated
// the staggered `rise` entrance and the colour/background state transitions.
import { type CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useMotion, SPRING } from "../../lib/motion";
import { Spinner } from "../ui/Spinner";

export type StepRowState = "done" | "soft" | "running" | "queued" | "failed";

export interface StepRowStep {
  title: string;
  note?: string;
  runningNote?: string;
}

export interface StepRowProps {
  step: StepRowStep;
  state: StepRowState;
  /** Position in the list — drives the `rise` stagger (handoff: i * 70ms). */
  index?: number;
  /**
   * The step's server-set completion time (InvestigationStep.finished_at), an
   * ISO string. Rendered in col1 for terminal rows so each row shows when *it*
   * actually closed — not when the list mounted. Null/absent renders an em dash
   * rather than a fabricated clock reading.
   */
  finishedAt?: string | null;
}

const RIGHT_LABEL: Record<StepRowState, string> = {
  done: "Closed",
  soft: "Soft close",
  running: "Open",
  queued: "Queued",
  failed: "Failed",
};

// Handoff renderVals port. dotBg/dotBorder -> the status square; title/note ->
// text colours; label -> the right-hand state word. `failed` isn't in the
// prototype (the progress list only models done/running/queued/soft) so it
// reuses the app's critical treatment.
interface StateStyle {
  dotBg: string;
  dotBorder: string;
  title: string;
  note: string;
  label: string;
  runningRow: boolean;
}

const STATE_STYLE: Record<StepRowState, StateStyle> = {
  done: {
    dotBg: "var(--color-ink)",
    dotBorder: "var(--color-ink)",
    title: "var(--color-ink)",
    note: "var(--color-secondary)",
    label: "var(--color-ink)",
    runningRow: false,
  },
  soft: {
    dotBg: "var(--color-page)",
    dotBorder: "var(--color-suspicious)",
    title: "var(--color-ink)",
    note: "var(--color-suspicious)",
    label: "var(--color-suspicious)",
    runningRow: false,
  },
  running: {
    dotBg: "var(--color-page)",
    dotBorder: "var(--color-ink)",
    title: "var(--color-ink)",
    note: "var(--color-secondary)",
    label: "var(--color-muted)",
    runningRow: true,
  },
  queued: {
    dotBg: "var(--color-page)",
    dotBorder: "var(--color-rule-strong)",
    title: "var(--color-faint)",
    note: "var(--color-faint)",
    label: "var(--color-faint)",
    runningRow: false,
  },
  failed: {
    dotBg: "var(--color-page)",
    dotBorder: "var(--color-critical)",
    title: "var(--color-ink)",
    note: "var(--color-critical)",
    label: "var(--color-critical)",
    runningRow: false,
  },
};

function squareStyle(s: StateStyle): CSSProperties {
  return {
    background: s.dotBg,
    border: `1px solid ${s.dotBorder}`,
    // Handoff: transition background 350ms ease, border-color 350ms ease.
    // Framer's `layout` won't tween these inline colours, so the crossfade
    // when a row flips state lives here in CSS.
    transition: "background 0.35s ease, border-color 0.35s ease",
  };
}

// The 11px status glyph. running -> spinner, done -> a check that draws
// itself, failed -> an X that draws itself; queued/soft keep the handoff's
// hollow square. Icons share the state's `dotBorder` colour (ink for
// running/done, critical for failed). Under reduced motion the check/X render
// fully drawn and only fade — no stroke draw, no pop — while the spinner keeps
// turning since it's the sole signal that a step is working.
function StepGlyph({ state, s }: { state: StepRowState; s: StateStyle }) {
  const reduce = useReducedMotion();

  if (state === "queued" || state === "soft") {
    return <div className="mt-[5px] h-[11px] w-[11px] rounded-none" style={squareStyle(s)} />;
  }

  if (state === "running") {
    return (
      <div className="mt-[5px]" style={{ color: s.dotBorder }} aria-hidden="true">
        <Spinner size={11} />
      </div>
    );
  }

  // done | failed — a self-drawing check or X.
  const draw = reduce
    ? { pathLength: 1, opacity: 1 }
    : { pathLength: [0, 1], opacity: [0, 1] };
  const drawTransition = reduce
    ? { duration: 0.2 }
    : { duration: 0.26, ease: SPRING.ease, opacity: { duration: 0.12 } };

  return (
    <motion.svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="mt-[5px]"
      style={{ width: 11, height: 11, color: s.dotBorder }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: SPRING.ease }}
    >
      {state === "done" ? (
        <motion.path
          d="M2.5 6.2 L4.9 8.6 L9.3 3.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
          animate={draw}
          transition={drawTransition}
        />
      ) : (
        <>
          <motion.path
            d="M3.2 3.2 L8.8 8.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            initial={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            animate={draw}
            transition={drawTransition}
          />
          <motion.path
            d="M8.8 3.2 L3.2 8.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            initial={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            animate={draw}
            transition={reduce ? drawTransition : { ...drawTransition, delay: 0.08 }}
          />
        </>
      )}
    </motion.svg>
  );
}

// Formats the step's completion time as a 24h HH:MM clock in the viewer's
// local timezone — the same shape the design handoff shows in col1.
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StepRow({ step, state, index = 0, finishedAt }: StepRowProps) {
  const { screenEnterAt } = useMotion();
  const s = STATE_STYLE[state];

  // col1: terminal rows show their own finish time (falling back to an em dash
  // when the server hasn't recorded one); active rows show their state word.
  const col1 =
    state === "done" || state === "soft" || state === "failed"
      ? finishedAt
        ? formatClock(finishedAt)
        : "—"
      : state === "running"
        ? "running"
        : "queued";
  const note = state === "running" && step.runningNote ? step.runningNote : step.note;
  const showNote = state === "done" || state === "soft" || state === "running";

  return (
    <motion.div
      layout
      data-step-state={state}
      // Handoff: `rise` (opacity 0 + translateY 16px -> 0), 620ms on the
      // shared curve, staggered i * 70ms down the list.
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={screenEnterAt(index * 0.07)}
      // On phones (≤430px) the four fixed tracks starve the title column, so
      // collapse to three (timestamp · glyph · title) and drop the right-hand
      // status label — the glyph already carries state — via max-[430px]:hidden
      // on that cell below.
      className="grid grid-cols-[88px_22px_1fr_108px] items-start gap-[14px] border-t border-rule px-2 py-[15px] max-[430px]:grid-cols-[52px_18px_1fr] max-[430px]:gap-2"
      style={{
        // Handoff: running rows tint #FAFAFA; transition background 400ms ease.
        background: s.runningRow ? "var(--color-neutral-row)" : "var(--color-page)",
        transition: "background 0.4s ease",
      }}
    >
      <div className="pt-[3px] font-mono text-[11px]" style={{ color: "var(--color-faint)" }}>
        {col1}
      </div>
      <StepGlyph state={state} s={s} />
      {/* min-w-0 so this 1fr track can shrink below its content instead of
          overflowing the row (grid children default to min-width:auto);
          break-words folds a long unbroken token — same overflow guard the
          SourceList/RecentChecks rows use. */}
      <div className="min-w-0">
        <div
          className="text-[16px] font-bold break-words"
          style={{ color: s.title, transition: "color 0.35s ease" }}
        >
          {step.title}
        </div>
        {showNote && (
          <div
            className="mt-1 text-[13px] leading-[1.5] break-words"
            style={{ color: s.note, transition: "color 0.35s ease" }}
          >
            {note}
          </div>
        )}
      </div>
      <div
        className="pt-[3px] text-right text-[10px] uppercase tracking-[0.1em] max-[430px]:hidden"
        style={{ color: s.label }}
      >
        {RIGHT_LABEL[state]}
      </div>
    </motion.div>
  );
}
