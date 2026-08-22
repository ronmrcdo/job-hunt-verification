// The check-allowance panel shown above "RUN THE CHECK": a datasheet-style
// readout of the two reservoirs a run draws from — the weekly quota and the
// bonus (top-up) balance — plus when the weekly window resets.
//
// Accessibility: one plain-language `sr-only` sentence is the sole accessible
// text for the whole panel. Every visual numeral, pip, and micro-label is
// `aria-hidden`, so assistive tech hears the summary once ("2 of 3 weekly
// checks left…") instead of a stream of disconnected fragments ("2", "/ 3",
// "left", "weekly checks", "resets 09/04").
import { pad2 } from "../../lib/format";
import { MicroLabel } from "../ui/MicroLabel";
import { quotaView, type QuotaStatus } from "../../lib/investigations";

function formatReset(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

export function QuotaMeter({ quota }: { quota: QuotaStatus }) {
  const { weeklyRemaining, topUp, exhausted } = quotaView(quota);
  const { weeklyLimit } = quota;
  const reset = formatReset(quota.resetsAt);

  const summary = exhausted
    ? `0 of ${weeklyLimit} weekly checks left, no bonus checks. All checks used${reset ? `; weekly quota resets ${reset}` : ""}.`
    : `${weeklyRemaining} of ${weeklyLimit} weekly checks left${topUp > 0 ? `, +${topUp} bonus checks` : ""}${reset ? `. Resets ${reset}.` : ""}`;

  return (
    <div
      className={[
        "rounded-none border",
        // Outer frame matches the input fields (border-ink); the internal
        // dividers stay hairline (border-rule) so the card reads as one framed
        // unit with quiet sections rather than a stack of heavy boxes.
        exhausted ? "border-warn-rule bg-warn-tint" : "border-ink bg-page",
      ].join(" ")}
    >
      <p className="sr-only">{summary}</p>

      {/* Weekly reservoir — the numeral is the object, so it carries the size;
          the pip row echoes it as an at-a-glance depletion cue. */}
      <div aria-hidden className="px-4 pb-[14px] pt-[13px]">
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>weekly checks</MicroLabel>
          {reset ? <MicroLabel>resets {reset}</MicroLabel> : null}
        </div>
        <div className="mt-[10px] flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[32px] leading-none tabular-nums text-ink">
              {weeklyRemaining}
            </span>
            <span className="font-mono text-[15px] leading-none tabular-nums text-muted">
              / {weeklyLimit}
            </span>
            <span className="ml-1 text-[13px] leading-none text-muted">left</span>
          </div>
          {/* Filled = a check still available; hairline outline = spent.
              flex-wrap + justify-end so a larger weekly limit folds onto a
              second line instead of overrunning the card on narrow screens. */}
          <div className="flex flex-wrap items-center justify-end gap-[3px]">
            {Array.from({ length: weeklyLimit }).map((_, i) => (
              <span
                key={i}
                className={[
                  "h-[10px] w-[10px] rounded-none",
                  i < weeklyRemaining ? "bg-ink" : "border border-rule-strong",
                ].join(" ")}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bonus reservoir — a stored balance, so it stands on its own line
          rather than trailing the weekly count as a "· +N" afterthought. */}
      {topUp > 0 ? (
        <div
          aria-hidden
          className="flex items-center justify-between gap-3 border-t border-rule px-4 py-[11px]"
        >
          <MicroLabel>bonus checks</MicroLabel>
          <span className="font-mono text-[15px] leading-none tabular-nums text-ink">
            +{topUp}
          </span>
        </div>
      ) : null}

      {/* Blocked footer — names the cause and the recovery path (wait for the
          reset) up front, before the user reaches an already-disabled submit. */}
      {exhausted ? (
        <p
          aria-hidden
          className="border-t border-warn-rule px-4 py-[11px] text-[12px] leading-[1.5] text-ink"
        >
          All checks used.
          {reset ? ` Weekly quota resets ${reset}.` : " Weekly quota resets soon."}
        </p>
      ) : null}
    </div>
  );
}
