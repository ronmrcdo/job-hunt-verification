"use client";

// Sticky report sidebar: the counts strip plus the save/check-another
// actions and a reminder of where the report is saved. Product rule #7:
// buttons describe what happens ("Save this report"), never "Submit".
import { useRouter } from "next/navigation";
import type { ReportVM } from "../../lib/report-view-model";
import { useFlow } from "../../lib/flow-context";
import { CountsStrip } from "./CountsStrip";
import { Button } from "../ui/Button";
import { MicroLabel } from "../ui/MicroLabel";

export interface ReportRailProps {
  vm: ReportVM;
  saved: boolean;
  onSave: () => void;
}

export function ReportRail({ vm, saved, onSave }: ReportRailProps) {
  const router = useRouter();
  const { state, reset } = useFlow();

  const handleCheckAnother = () => {
    reset();
    router.push("/");
  };

  return (
    <aside className="sticky top-[90px] flex flex-col gap-6 border border-ink p-6">
      <CountsStrip vm={vm} />

      <div className="flex flex-col gap-3">
        <Button variant="primary" size="wide" onClick={onSave} disabled={saved}>
          {saved ? "Saved to your account" : "Save this report"}
        </Button>
        <Button variant="secondary" size="wide" onClick={handleCheckAnother}>
          Check another posting
        </Button>
      </div>

      <div className="rounded-none border border-ink-muted p-4">
        <MicroLabel>SAVED TO</MicroLabel>
        <p className="mt-2 font-mono text-[12px]">{state.authEmail}</p>
        <p className="mt-2 text-[12px] text-muted">
          Reports stay private to your account. Repeat checks on the same posting are counted, never
          published.
        </p>
      </div>
    </aside>
  );
}
