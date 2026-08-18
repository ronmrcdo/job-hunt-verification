import { MicroLabel } from "../ui/MicroLabel";
import { Button } from "../ui/Button";

export interface FetchErrorPanelProps {
  onPasteInstead: () => void;
}

export function FetchErrorPanel({ onPasteInstead }: FetchErrorPanelProps) {
  return (
    <div role="alert" className="mt-3 rounded-none border border-warn-rule bg-warn-tint p-3">
      <MicroLabel>FETCH FAILED</MicroLabel>
      <p className="mt-1 text-[13px] leading-[1.5]">
        We couldn&apos;t read that page — it may need a login.
      </p>
      <p className="mt-1 text-[13px] leading-[1.5]">
        Paste the job text instead and we&apos;ll work from that.
      </p>
      <Button size="wide" className="mt-3" onClick={onPasteInstead}>
        PASTE THE JOB TEXT INSTEAD
      </Button>
    </div>
  );
}
