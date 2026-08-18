import { useReducedMotion } from "framer-motion";

/** Shared easing curve — never inline a different curve in a component. */
export const SPRING = { ease: [0.22, 1, 0.36, 1] as const };

export const screenEnter = { ...SPRING, duration: 0.62 };
export const fade = { duration: 0.42 };
export const expand = { ...SPRING, duration: 0.62 };
export const colorShift = { duration: 0.3 };

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

  if (reduce) {
    return {
      ...reducedTransitions,
      screenEnterVariants: reducedScreenEnterVariants,
      staggerParent: reducedStaggerParent,
      expandVariants,
    };
  }

  return {
    screenEnter,
    fade,
    expand,
    colorShift,
    screenEnterVariants,
    staggerParent,
    expandVariants,
  };
}
