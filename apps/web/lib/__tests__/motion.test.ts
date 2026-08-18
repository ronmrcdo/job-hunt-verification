import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { screenEnter, expand, tooltip, staggerParent, expandVariants, useMotion } from "../motion";

// useMotion() reads useReducedMotion() from framer-motion — mock it so the
// reduced-motion branch of screenEnterAt is directly testable rather than
// only reachable through a real matchMedia toggle.
let reducedMotion = false;
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => reducedMotion };
});

describe("motion presets", () => {
  it("screenEnter uses the shared SPRING ease curve for its translate-y transition", () => {
    expect(screenEnter.ease).toEqual([0.22, 1, 0.36, 1]);
  });

  it("screenEnter resolves translate-y over 620ms and opacity over 420ms per spec", () => {
    expect(screenEnter.duration).toBe(0.62);
    expect(screenEnter.opacity.duration).toBe(0.42);
  });

  it("expand resolves height over 620ms and opacity over 380ms per spec", () => {
    expect(expand.height.duration).toBe(0.62);
    expect(expand.opacity.duration).toBe(0.38);
  });

  it("tooltip resolves over 150ms per spec", () => {
    expect(tooltip.duration).toBe(0.15);
  });

  it("staggerParent staggers children by 0.08s", () => {
    expect(staggerParent.visible.transition.staggerChildren).toBe(0.08);
  });

  it("expandVariants opens to auto height", () => {
    expect(expandVariants.open.height).toBe("auto");
  });
});

describe("useMotion's screenEnterAt", () => {
  it("bakes the delay into both the top-level (y) and opacity sub-transition", () => {
    reducedMotion = false;
    const { result } = renderHook(() => useMotion());
    const transition = result.current.screenEnterAt(0.36) as {
      delay: number;
      duration: number;
      opacity: { delay: number; duration: number };
    };

    expect(transition.delay).toBe(0.36);
    expect(transition.duration).toBe(0.62);
    expect(transition.opacity.delay).toBe(0.36);
    expect(transition.opacity.duration).toBe(0.42);
  });

  it("drops both duration and delay to 0 under reduced motion, instead of a zero-duration tween that still staggers", () => {
    reducedMotion = true;
    const { result } = renderHook(() => useMotion());

    expect(result.current.screenEnterAt(0.36)).toEqual({ duration: 0 });
  });
});
