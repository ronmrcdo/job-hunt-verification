import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SegmentBar } from "../SegmentBar";

describe("SegmentBar", () => {
  it("renders 4 segments with exactly 3 filled for a band bar", () => {
    const { container } = render(
      <SegmentBar total={4} filled={3} fillColor="var(--color-band-high)" emptyColor="var(--color-ink-muted)" />
    );
    const segments = container.querySelectorAll("[data-filled]");
    expect(segments).toHaveLength(4);

    const filled = container.querySelectorAll('[data-filled="true"]');
    const empty = container.querySelectorAll('[data-filled="false"]');
    expect(filled).toHaveLength(3);
    expect(empty).toHaveLength(1);

    filled.forEach((el) => {
      expect((el as HTMLElement).style.background).toContain("var(--color-band-high)");
    });
    empty.forEach((el) => {
      expect((el as HTMLElement).style.background).toContain("var(--color-ink-muted)");
    });
  });

  it("renders 3 segments with exactly 2 filled for a confidence meter", () => {
    const { container } = render(
      <SegmentBar total={3} filled={2} fillColor="var(--color-band-high)" emptyColor="var(--color-ink-muted)" />
    );
    expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-filled="false"]')).toHaveLength(1);
  });

  it("is aria-hidden by default", () => {
    const { container } = render(
      <SegmentBar total={4} filled={2} fillColor="var(--color-band-high)" emptyColor="var(--color-ink-muted)" />
    );
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("allows overriding ariaHidden", () => {
    const { container } = render(
      <SegmentBar
        total={4}
        filled={2}
        fillColor="var(--color-band-high)"
        emptyColor="var(--color-ink-muted)"
        ariaHidden={false}
      />
    );
    expect(container.firstElementChild).not.toHaveAttribute("aria-hidden");
  });

  it("clamps filled to the range [0, total]", () => {
    const over = render(
      <SegmentBar total={4} filled={10} fillColor="var(--color-band-high)" emptyColor="var(--color-ink-muted)" />
    );
    expect(over.container.querySelectorAll('[data-filled="true"]')).toHaveLength(4);

    const under = render(
      <SegmentBar total={4} filled={-2} fillColor="var(--color-band-high)" emptyColor="var(--color-ink-muted)" />
    );
    expect(under.container.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
  });
});
