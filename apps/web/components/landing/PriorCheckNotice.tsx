import { MicroLabel } from "../ui/MicroLabel";

export function PriorCheckNotice() {
  return (
    <div className="mt-3 rounded-none bg-surface-soft p-3">
      <MicroLabel>PRIOR CHECK ON FILE</MicroLabel>
      <p className="mt-1 text-[13px] leading-[1.5]">
        This posting was checked 2 days ago — view that report or run a fresh check.
      </p>
    </div>
  );
}
