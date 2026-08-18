"use client";

// Renders the seven scripted steps in DISPLAY order (1..7) while each row's
// state is derived from COMPLETION progress, which closes out of order
// (1, 3, 4, 2, 5, 6, 7) — see progress-script.ts.
import { COMPLETION_ORDER, STEPS, type ProgressStep } from "./progress-script";
import { StepRow, type StepRowState } from "./StepRow";

export interface StepListProps {
  steps?: ProgressStep[];
  doneSteps: number[] | Set<number>;
  caseId?: string;
}

function stepState(step: ProgressStep, done: Set<number>): StepRowState {
  if (done.has(step.id)) return step.soft ? "soft" : "done";
  const runningId = COMPLETION_ORDER.find((id) => !done.has(id));
  return step.id === runningId ? "running" : "queued";
}

export function StepList({ steps = STEPS, doneSteps, caseId }: StepListProps) {
  const done = doneSteps instanceof Set ? doneSteps : new Set(doneSteps);

  return (
    <div>
      {caseId && (
        <div className="pb-3 font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
          CASE {caseId} · {done.size} of 7 steps closed
        </div>
      )}
      <div>
        {steps.map((step) => (
          <StepRow key={step.id} step={step} state={stepState(step, done)} />
        ))}
      </div>
    </div>
  );
}
