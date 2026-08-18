"use client";

// Scroll-triggered entrance. The hero rises on page load (it's above the
// fold); sections further down instead rise the first time they scroll into
// view — the prototype's `rise` keyframe fires once on load, which for
// below-the-fold content plays off-screen, so keying it to viewport entry is
// the faithful-in-spirit upgrade. Reuses the shared screenEnter values and
// respects reduced motion (movement + stagger drop out) via useMotion.
import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { useMotion } from "../../lib/motion";

interface RevealProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  // Passthrough for data-* hooks (e.g. FourBands' `data-band-card`, which the
  // report/landing tests query on).
  [dataAttr: `data-${string}`]: string | undefined;
}

// Stagger container: marks the section as hidden until it enters the
// viewport, then reveals its <RevealItem> children one after another.
export function Reveal({ children, className, style }: RevealProps) {
  const motionPreset = useMotion();
  return (
    <motion.div
      className={className}
      style={style}
      variants={motionPreset.staggerParent}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
    >
      {children}
    </motion.div>
  );
}

// A staggered child that is ALSO a stagger parent for its own <RevealItem>
// children — use it for a row of sibling cards so each card rises on its own
// slot (the prototype staggers cards individually, ~70–90ms apart) instead of
// the whole row rising as one block. It inherits the enter state from the
// outer <Reveal> and re-staggers it across its children; it doesn't fade
// itself, so the row's layout classes stay purely structural.
export function RevealGroup({ children, className, style }: RevealProps) {
  const motionPreset = useMotion();
  return (
    <motion.div className={className} style={style} variants={motionPreset.staggerParent}>
      {children}
    </motion.div>
  );
}

// One staggered child — fades + rises 16px on its slot in the sequence.
export function RevealItem({ children, className, style, ...rest }: RevealProps) {
  const motionPreset = useMotion();
  return (
    <motion.div
      className={className}
      style={style}
      variants={motionPreset.screenEnterVariants}
      transition={motionPreset.screenEnter}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
