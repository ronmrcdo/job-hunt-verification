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
