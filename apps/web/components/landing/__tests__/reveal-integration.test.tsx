import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Integration: exercises the per-sibling stagger fix through the REAL landing
// sections (HowItRuns / FourBands) composing the real Reveal stack. Same
// capture-mock as the Reveal unit test — `motion.div` becomes a plain div that
// serializes its `variants` so the composed stagger structure is observable.
// Regression guard: the pre-fix code wrapped every card row in a SINGLE
// RevealItem, so all cards rose as one block. The fix makes each card its own
// RevealItem inside a RevealGroup; these tests assert exactly that wiring.
let reducedMotion = false;

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const React = await import("react");
  const makeMotionComponent = (tag: string) =>
    function MockMotion({
      children,
      variants,
      transition,
      initial,
      animate,
      exit,
      whileInView,
      whileHover,
      whileTap,
      viewport,
      layout,
      custom,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode }) {
      return React.createElement(
        tag,
        {
          ...rest,
          "data-variants": variants ? JSON.stringify(variants) : undefined,
          "data-transition": transition ? JSON.stringify(transition) : undefined,
        },
        children,
      );
    };
  const motion = new Proxy(
    {},
    { get: (_target, tag) => makeMotionComponent(String(tag)) },
  );
  return { ...actual, useReducedMotion: () => reducedMotion, motion };
});

import { HowItRuns } from "../HowItRuns";
import { FourBands } from "../FourBands";

const variantsOf = (el: Element) =>
  JSON.parse(el.getAttribute("data-variants") ?? "null");

beforeEach(() => {
  reducedMotion = false;
});

describe("HowItRuns stagger integration", () => {
  it("wraps each of the four steps in its own reveal item under a stagger group", () => {
    render(<HowItRuns />);
    // The nearest animated ancestor of each step number is that step's card.
    const cards = ["01", "02", "03", "04"].map(
      (n) => screen.getByText(n).closest("[data-variants]") as HTMLElement,
    );

    // Four DISTINCT items — pre-fix, all four shared one wrapping RevealItem,
    // which would collapse this Set to size 1.
    expect(new Set(cards).size).toBe(4);

    cards.forEach((card) => {
      expect(variantsOf(card).hidden.y).toBe(16); // each card rises individually
      const group = card.parentElement as HTMLElement;
      expect(variantsOf(group).visible.transition.staggerChildren).toBe(0.08);
    });
  });
});

describe("FourBands stagger integration", () => {
  it("makes every band card its own reveal item under a stagger group", () => {
    const { container } = render(<FourBands />);
    const cards = Array.from(
      container.querySelectorAll("[data-band-card]"),
    ) as HTMLElement[];

    expect(cards).toHaveLength(4);
    cards.forEach((card) => {
      // Pre-fix these were plain <div>s with no variant at all.
      expect(variantsOf(card).hidden.y).toBe(16);
      const group = card.parentElement as HTMLElement;
      expect(variantsOf(group).visible.transition.staggerChildren).toBe(0.08);
    });
  });

  it("collapses movement and stagger to zero across the section under reduced motion", () => {
    reducedMotion = true;
    const { container } = render(<FourBands />);
    const card = container.querySelector("[data-band-card]") as HTMLElement;

    expect(variantsOf(card).hidden.y).toBeUndefined();
    expect(variantsOf(card.parentElement as HTMLElement).visible.transition.staggerChildren).toBe(0);
  });
});
