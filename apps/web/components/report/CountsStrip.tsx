import type { ReportVM } from "../../lib/report-view-model";
import { pad2 } from "../../lib/format";

export interface CountsStripProps {
  vm: ReportVM;
}

function countFor(vm: ReportVM, key: ReportVM["groups"][number]["key"]): string {
  const group = vm.groups.find((g) => g.key === key);
  return pad2(group?.findings.length ?? 0);
}

// Product rule #1: counts are counts, never a score/percentage.
// Product rule #6: the unverifiable cell stays neutral/muted, not a warning.
export function CountsStrip({ vm }: CountsStripProps) {
  const legit = countFor(vm, "legitimizing");
  const suspicious = countFor(vm, "suspicious");
  const unverified = countFor(vm, "unverifiable");

  return (
    <div className="grid grid-cols-3">
      <div data-testid="count-legit" data-count-key="legit" className="rounded-none">
        <span className="font-mono" style={{ color: "var(--color-legit)" }}>
          {legit}
        </span>{" "}
        checks out
      </div>
      <div
        data-testid="count-suspicious"
        data-count-key="suspicious"
        className="rounded-none"
        style={{ background: "var(--color-warn-tint)" }}
      >
        <span className="font-mono" style={{ color: "var(--color-suspicious)" }}>
          {suspicious}
        </span>{" "}
        suspicious
      </div>
      <div data-testid="count-unverified" data-count-key="unverified" className="rounded-none">
        <span className="font-mono" style={{ color: "var(--color-muted)" }}>
          {unverified}
        </span>{" "}
        unverified
      </div>
    </div>
  );
}
