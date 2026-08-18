"use client";

// Tickable "verify it yourself" block. Checked state is local/ephemeral — it
// exists only to let the reader work through the list, it is never persisted
// or reported back (this list isn't part of the assessment).
import { useState } from "react";
import { MicroLabel } from "../ui/MicroLabel";
import { pad2 } from "../../lib/format";

const HEADING_BY_COUNT: Record<number, string> = {
  4: "FOUR CHECKS THAT WOULD SETTLE THIS",
  3: "THREE CHECKS WORTH DOING ANYWAY",
};

function headingFor(count: number): string {
  return HEADING_BY_COUNT[count] ?? `${count} CHECKS WORTH DOING`;
}

export interface VerifyChecklistProps {
  items: string[];
}

export function VerifyChecklist({ items }: VerifyChecklistProps) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const toggle = (index: number) => {
    setChecked((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <section className="rounded-none border border-ink">
      <div className="flex items-center justify-between p-6 pb-0">
        <MicroLabel>VERIFY IT YOURSELF</MicroLabel>
        <span className="font-mono text-[10px] text-muted">{pad2(items.length)}</span>
      </div>
      <div className="px-6 pt-2">
        <h2 className="text-[28px] font-bold uppercase leading-tight tracking-tight">
          {headingFor(items.length)}
        </h2>
        <p className="mt-2 text-muted">These close the gaps we couldn't. Each takes a few minutes.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
        {items.map((item, index) => {
          const isChecked = Boolean(checked[index]);
          return (
            <button
              key={index}
              type="button"
              role="checkbox"
              aria-checked={isChecked}
              // Space/Enter activation comes from the native <button>'s own
              // onClick (ruling R12) — no keydown handler needed, and adding
              // one that also toggles on Space would double-toggle in a real
              // browser (keydown toggles once, then the native keyup click
              // toggles it back).
              onClick={() => toggle(index)}
              className="flex items-start gap-3 rounded-none text-left max-[430px]:min-h-[44px] max-[430px]:items-center"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center border border-ink max-[430px]:mt-0 max-[430px]:h-11 max-[430px]:w-11"
                style={isChecked ? { background: "var(--color-ink)" } : undefined}
              >
                {isChecked ? <span className="text-[12px] text-page">✓</span> : null}
              </span>
              <span className={isChecked ? "line-through text-muted" : undefined}>{item}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
