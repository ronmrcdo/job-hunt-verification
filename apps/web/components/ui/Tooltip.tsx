"use client";

import { useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMotion } from "../../lib/motion";

export interface TooltipProps {
  label: string;
  children: ReactNode;
  // Mirrors MicroLabel's tone prop: lets a caller on a dark background (e.g.
  // ConfidencePanel on BandBanner's ink band) pass a light border/glyph
  // color so the trigger stays visible (WCAG 1.4.11 non-text contrast).
  // Defaults to the ink border used everywhere else.
  tone?: string;
}

/**
 * A `?` affordance that reveals an explanatory panel on click or focus.
 * Closes on Escape or when focus leaves the widget entirely (blur to
 * outside the trigger/panel).
 */
export function Tooltip({ label, children, tone }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // useMotion() zeroes the tooltip preset's duration under reduced motion,
  // so this panel collapses to an instant show for free.
  const { tooltip: transition } = useMotion();

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

  // Escape is the only key this handler needs: Enter/Space are already
  // handled by the native <button>'s own onClick activation (ruling R12 —
  // a native button fires its activation click on keyup for Space and on
  // keydown for Enter with zero JS; a manual keydown-Space toggle here
  // would double-toggle in a real browser back to a no-op, since
  // preventDefault() on keydown only suppresses the page-scroll, not the
  // native keyup click). jsdom's fireEvent can't exercise that native
  // activation path, so it isn't asserted via keydown simulation in tests —
  // instead the tests assert this is a real <button>, which is what
  // guarantees the platform gives us Enter/Space activation for free.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative inline-block" onBlur={handleBlur}>
      <button
        type="button"
        aria-expanded={open}
        // Only reference the panel's id while it's actually mounted —
        // AnimatePresence unmounts it on close, so pointing aria-controls
        // at a closed panel's id would target a nonexistent element.
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className={[
          "rounded-none border w-5 h-5 text-[10px] leading-none inline-flex items-center justify-center max-[430px]:h-11 max-[430px]:w-11",
          tone ? "" : "border-ink",
        ]
          .filter(Boolean)
          .join(" ")}
        style={tone ? { borderColor: tone, color: tone } : undefined}
      >
        ?
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="tooltip"
            style={{ transformOrigin: "top left" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={transition}
            className="absolute z-10 mt-1 rounded-none border border-ink bg-page p-2 text-[12px]"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
