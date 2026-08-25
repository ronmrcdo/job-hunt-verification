import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// framer-motion resolves its animation to the SAME final DOM whether or not
// reduced motion is on, so a rendered-output assertion can't tell the two
// apart. Replace `motion.div` with a plain div that serializes the `variants`
// and `transition` props it was handed onto data-attributes — that's what
// carries the movement/stagger the component actually asked for. Also drive
// `useReducedMotion` (read via useMotion) so the reduced branch is testable.
let reducedMotion = false;

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const React = await import("react");
  const makeMotionComponent = (tag: string) =>
    function MockMotion({
      children,
      variants,
      transition,
      // Framer-only props stripped so React doesn't warn about unknown DOM attrs.
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
          "data-viewport": viewport ? JSON.stringify(viewport) : undefined,
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

import { Reveal, RevealGroup, RevealItem } from "../Reveal";

const variantsOf = (el: Element) =>
  JSON.parse(el.getAttribute("data-variants") ?? "null");
const transitionOf = (el: Element) =>
  JSON.parse(el.getAttribute("data-transition") ?? "null");
const viewportOf = (el: Element) =>
  JSON.parse(el.getAttribute("data-viewport") ?? "null");

// Framer hands `amount` straight to IntersectionObserver as `threshold`,
// mapping the names the same way (framer-motion/dist/es/motion/features/
// viewport/index.mjs).
const THRESHOLD_NAMES: Record<string, number> = { some: 0, all: 1 };
const thresholdOf = (el: Element): number => {
  const amount = viewportOf(el)?.amount ?? "some";
  return typeof amount === "number" ? amount : THRESHOLD_NAMES[amount];
};

beforeEach(() => {
  reducedMotion = false;
});

describe("Reveal (unit)", () => {
  it("renders children and drives its <RevealItem> children as a stagger container", () => {
    const { container } = render(
      <Reveal className="wrap" style={{ gap: "1rem" }}>
        <span>content</span>
      </Reveal>,
    );
    const root = container.firstElementChild as HTMLElement;

    expect(screen.getByText("content")).toBeTruthy();
    expect(root).toHaveClass("wrap");
    expect(root.style.gap).toBe("1rem");
    expect(variantsOf(root).visible.transition.staggerChildren).toBe(0.08);
  });

  // Regression: a <Reveal> can wrap a section far taller than the viewport —
  // the report page wraps its whole findings column in one, and a 36-finding
  // report runs to several screens. The browser measures intersectionRatio
  // against the TARGET's own box, so a section 5x the viewport height tops out
  // near 0.2 and anything taller can never reach it. A fractional `amount`
  // therefore leaves whileInView unfired forever and every child stranded on
  // the `hidden` variant at opacity 0 — a blank white column.
  it("enters on a threshold a section taller than the viewport can still cross", () => {
    const { container } = render(
      <Reveal>
        <span>tall section</span>
      </Reveal>,
    );
    const root = container.firstElementChild as HTMLElement;

    // A 36-finding report column measures roughly 6000px in a 900px viewport,
    // so its intersection ratio can never exceed ~0.15.
    const tallestReachableRatio = 900 / 6000;
    expect(thresholdOf(root)).toBeLessThanOrEqual(tallestReachableRatio);
    // Still a once-only entrance.
    expect(viewportOf(root).once).toBe(true);
  });
});

describe("RevealItem (unit)", () => {
  it("fades + rises 16px on its slot and forwards className, style, and data-* attrs", () => {
    render(
      <RevealItem className="card" style={{ flexBasis: "240px" }} data-band-card="LOW" data-ink="false">
        item
      </RevealItem>,
    );
    const el = screen.getByText("item");

    expect(el).toHaveClass("card");
    expect(el.style.flexBasis).toBe("240px");
    expect(el.getAttribute("data-band-card")).toBe("LOW");
    expect(el.getAttribute("data-ink")).toBe("false");

    const variants = variantsOf(el);
    expect(variants.hidden).toEqual({ opacity: 0, y: 16 });
    expect(variants.visible).toEqual({ opacity: 1, y: 0 });
    // translate-y over 620ms per the shared screenEnter spec.
    expect(transitionOf(el).duration).toBe(0.62);
  });
});

describe("RevealGroup (unit)", () => {
  it("staggers its own children without fading itself", () => {
    const { container } = render(
      <RevealGroup className="row">
        <span>a</span>
      </RevealGroup>,
    );
    const group = container.firstElementChild as HTMLElement;

    expect(group).toHaveClass("row");
    // It cascades its children...
    expect(variantsOf(group).visible.transition.staggerChildren).toBe(0.08);
    // ...but has no opacity/y entrance of its own, so the row's layout classes
    // stay purely structural.
    expect(variantsOf(group).hidden).toBeUndefined();
    expect(transitionOf(group)).toBeNull();
  });
});

describe("Reveal components under reduced motion", () => {
  it("RevealItem drops the y-translation, keeping an instant opacity-only reveal", () => {
    reducedMotion = true;
    render(<RevealItem>reduced-item</RevealItem>);
    const el = screen.getByText("reduced-item");

    const variants = variantsOf(el);
    expect(variants.hidden).toEqual({ opacity: 0 });
    expect(variants.hidden.y).toBeUndefined();
    expect(variants.visible).toEqual({ opacity: 1 });
    expect(transitionOf(el).duration).toBe(0);
  });

  it("RevealGroup collapses the per-child stagger to zero", () => {
    reducedMotion = true;
    const { container } = render(<RevealGroup>reduced-group</RevealGroup>);
    const group = container.firstElementChild as HTMLElement;

    expect(variantsOf(group).visible.transition.staggerChildren).toBe(0);
  });
});
