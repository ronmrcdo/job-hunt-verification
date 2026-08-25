"use client";

// Renders the real InvestigationStep rows in display_order. Each row's
// visual state is a direct map off the DB row's `status` — steps close out
// of order server-side, but the row that's currently `running` is always
// the one shown "Open" regardless of its position in the list.
import { StepRow, type StepRowState } from "./StepRow";
import type { InvestigationStep } from "../../lib/investigations";

export interface StepListProps {
  steps: InvestigationStep[];
  caseId?: string;
}

// Placeholder row count: the worker seeds a fixed 6-step checklist
// (apps/api graph/steps.py STEP_REGISTRY), so the skeleton reserves exactly
// that many rows and the layout doesn't jump when the real steps arrive.
const SKELETON_TITLE_WIDTHS = ["w-[62%]", "w-[74%]", "w-[55%]", "w-[68%]", "w-[71%]", "w-[48%]"];

// Shown while the worker hasn't inserted any step rows yet (queued, or the
// SELECT→Realtime gap on a fresh case). Mirrors StepRow's grid so nothing
// shifts on load. aria-hidden + a polite status line keep it quiet for AT;
// the bars only pulse when motion is allowed (matches ReportRail's idiom).
function StepListSkeleton() {
  return (
    <div>
      <div className="sr-only" role="status" aria-live="polite">
        Loading steps…
      </div>
      <div aria-hidden="true">
        {SKELETON_TITLE_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="grid grid-cols-[88px_22px_1fr_108px] items-start gap-[14px] border-t border-rule px-2 py-[15px] max-[430px]:grid-cols-[52px_18px_1fr] max-[430px]:gap-2"
          >
            <div className="mt-[3px] h-[11px] w-10 bg-surface-soft motion-safe:animate-pulse max-[430px]:w-8" />
            <div className="mt-[5px] h-[11px] w-[11px] bg-surface-soft motion-safe:animate-pulse" />
            <div className={`mt-[2px] h-[16px] ${width} bg-surface-soft motion-safe:animate-pulse`} />
            <div className="mt-[3px] ml-auto h-[10px] w-14 bg-surface-soft motion-safe:animate-pulse max-[430px]:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_TO_STATE: Record<string, StepRowState> = {
  done: "done",
  running: "running",
  pending: "queued",
  skipped: "soft",
  failed: "failed",
};

function stepState(status: string): StepRowState {
  return STATUS_TO_STATE[status] ?? "queued";
}

export function StepList({ steps, caseId }: StepListProps) {
  // No rows yet (queued case, or the brief SELECT→Realtime gap where the
  // worker hasn't written any steps) — hold the space with a skeleton rather
  // than an empty panel that reads as broken.
  if (steps.length === 0) return <StepListSkeleton />;

  const sorted = [...steps].sort((a, b) => a.display_order - b.display_order);
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div>
      {caseId && (
        <div
          aria-live="polite"
          className="pb-3 font-mono text-[12px] uppercase tracking-[0.1em] text-muted"
        >
          CASE {caseId} · {doneCount} of {steps.length} steps closed
        </div>
      )}
      <div>
        {sorted.map((step, i) => (
          <StepRow
            key={step.step_key}
            step={{ title: step.label }}
            state={stepState(step.status)}
            index={i}
            finishedAt={step.finished_at}
          />
        ))}
      </div>
    </div>
  );
}
