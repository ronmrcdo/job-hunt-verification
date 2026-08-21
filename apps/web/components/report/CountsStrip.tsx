import type { ReportVM } from "../../lib/report-view-model";
import { pad2 } from "../../lib/format";
import { MicroLabel } from "../ui/MicroLabel";

export interface CountsStripProps {
  vm: ReportVM;
}

function countFor(vm: ReportVM, key: ReportVM["groups"][number]["key"]): string {
  const group = vm.groups.find((g) => g.key === key);
  return pad2(group?.findings.length ?? 0);
}

const CELLS = [
  { key: "legitimizing", testId: "count-legit", dataKey: "legit", label: "checks out", color: "var(--color-legit)" },
  { key: "suspicious", testId: "count-suspicious", dataKey: "suspicious", label: "suspicious", color: "var(--color-suspicious)" },
  { key: "unverifiable", testId: "count-unverified", dataKey: "unverified", label: "unverified", color: "var(--color-muted)" },
] as const;

// Product rule #1: counts are counts, never a score/percentage.
// Product rule #6: the unverifiable cell stays neutral/muted, not a warning.
export function CountsStrip({ vm }: CountsStripProps) {
  // The strip exists to summarize a *spread* of findings at a glance. With one
  // finding total it degrades to 00/01/00 — two empty cells plus one number
  // the findings list already states in full, reading as scaffolding that
  // forgot to fill in. Below that threshold, render nothing and let the
  // findings speak for themselves.
  const total = vm.groups.reduce((sum, group) => sum + group.findings.length, 0);
  if (total <= 1) return null;

  return (
    // The numeral is the object here, so it gets the size and the label sits
    // under it as a caption — the inline "08 checks out" form let the label
    // wrap to a second line and knocked the three cells off a shared
    // baseline. Fixed cell height keeps them level whatever the label length.
    <div className="grid grid-cols-3 text-center">
      {CELLS.map((cell) => (
        <div
          key={cell.key}
          data-testid={cell.testId}
          data-count-key={cell.dataKey}
          className="rounded-none px-2 py-3"
          style={
            cell.key === "suspicious" ? { background: "var(--color-warn-tint)" } : undefined
          }
        >
          {/* tabular-nums so 08 and 11 occupy the same width and the three
              numerals stay optically centred against each other. */}
          <div
            className="font-mono text-[26px] leading-none tabular-nums"
            style={{ color: cell.color }}
          >
            {countFor(vm, cell.key)}
          </div>
          <MicroLabel className="mt-2 block">{cell.label}</MicroLabel>
        </div>
      ))}
    </div>
  );
}
