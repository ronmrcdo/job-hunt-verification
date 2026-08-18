"use client";

import { useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMotion } from "../../lib/motion";

export interface TooltipProps {
  label: string;
  children: ReactNode;
}

/**
 * A `?` affordance that reveals an explanatory panel on click or focus.
 * Closes on Escape or when focus leaves the widget entirely (blur to
 * outside the trigger/panel).
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // useMotion() zeroes preset durations under reduced motion; reuse that
  // signal so this panel collapses to an instant show, otherwise use the
  // fast easeOut this affordance needs.
  const { fade } = useMotion();
  const transition = fade.duration === 0 ? { duration: 0 } : { duration: 0.15, ease: "easeOut" as const };

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }

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
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="rounded-none border border-ink w-5 h-5 text-[10px] leading-none inline-flex items-center justify-center max-[430px]:h-11 max-[430px]:w-11"
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
