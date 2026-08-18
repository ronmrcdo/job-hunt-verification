import { useReducedMotion } from "framer-motion";

/** Shared easing curve — never inline a different curve in a component. */
export const SPRING = { ease: [0.22, 1, 0.36, 1] as const };

// Screen entrances resolve opacity and translate-y on separate clocks per
// spec (420ms opacity / 620ms translate). Framer Motion does NOT merge a
// per-key transition override with its sibling top-level values — it
// resolves as `transition[key] ?? transition.default ?? transition` — so
// `opacity` needs its own explicit duration/ease rather than inheriting
// the top-level ones, which apply to `y` (the only animating key without
// its own override).
export const screenEnter = {
  duration: 0.62,
  ease: SPRING.ease,
  opacity: { duration: 0.42, ease: SPRING.ease },
};

export const fade = { duration: 0.42 };

// Finding expand: height and opacity also resolve on separate clocks per
// spec (620ms height / 380ms opacity) — same per-key caveat as screenEnter.
export const expand = {
  height: { ...SPRING, duration: 0.62 },
  opacity: { duration: 0.38, ease: SPRING.ease },
};

export const colorShift = { duration: 0.3 };

// Tooltip/expand-panel reveal — spec: 150ms. Lives here (not inlined in
// Tooltip.tsx) so every component consumes the same source of truth.
export const tooltip = { duration: 0.15, ease: "easeOut" as const };

export const screenEnterVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export const staggerParent = {
  visible: { transition: { staggerChildren: 0.08 } },
};

export const expandVariants = {
  collapsed: { height: 0, opacity: 0 },
  open: { height: "auto", opacity: 1 },
};

const reducedTransitions = {
  screenEnter: { duration: 0 },
  fade: { duration: 0 },
  expand: { duration: 0 },
  colorShift: { duration: 0 },
  tooltip: { duration: 0 },
};

const reducedScreenEnterVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const reducedStaggerParent = {
  visible: { transition: { staggerChildren: 0 } },
};

/**
 * Reads the user's reduced-motion preference and returns the transition
 * presets + variants components should consume. When motion is reduced,
 * movement (y-offsets, stagger delay) drops out and durations go to zero
 * so changes resolve instantly instead of animating.
 */
export function useMotion() {
  const reduce = useReducedMotion();

  // Builds the per-child screen-entrance transition for a staggered delay
  // (the landing hero's staggered children). The delay has to be baked
  // into BOTH the top-level object (which `y` falls back to) and the
  // `opacity` sub-transition — see the comment on `screenEnter` above —
  // and dropped to 0 entirely under reduced motion. Otherwise a
  // zero-duration tween would still stagger in child-by-child over the
  // full 0–360ms span instead of resolving as one instant reveal.
  function screenEnterAt(delay = 0) {
    if (reduce) return { duration: 0 };
    return {
      ...screenEnter,
      delay,
      opacity: { ...screenEnter.opacity, delay },
    };
  }

  if (reduce) {
    return {
      ...reducedTransitions,
      screenEnterVariants: reducedScreenEnterVariants,
      staggerParent: reducedStaggerParent,
      expandVariants,
      screenEnterAt,
    };
  }

  return {
    screenEnter,
    fade,
    expand,
    colorShift,
    tooltip,
    screenEnterVariants,
    staggerParent,
    expandVariants,
    screenEnterAt,
  };
}
