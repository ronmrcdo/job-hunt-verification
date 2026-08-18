// Preview of the pasted posting queued behind the sign-in gate. The
// posting is shown as plain mono text — never an <a href> — per Rule #4
// (no suspicious-URL links), even when the posting is itself a URL.
import { MicroLabel } from "../ui/MicroLabel";
import { useFlow } from "../../lib/flow-context";
import { detectInput, type DetectionState } from "../../lib/detect";

const DETECTION_LABEL: Record<DetectionState, string> = {
  empty: "Waiting for input",
  link: "Link detected",
  text: "Job text detected",
};

export function QueuedCard() {
  const { state } = useFlow();
  const detection = detectInput(state.jobInput);

  return (
    <div className="rounded-none border border-rule bg-surface-soft p-4">
      <MicroLabel>QUEUED POSTING</MicroLabel>
      <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.6]">
        {state.jobInput}
      </p>
      <p className="mt-2 text-[13px] text-muted">
        {DETECTION_LABEL[detection]} · runs as soon as you&apos;re in
      </p>
    </div>
  );
}
