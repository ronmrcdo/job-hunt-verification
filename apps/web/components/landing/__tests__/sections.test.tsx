import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HowItRuns } from "../HowItRuns";
import { FourBands } from "../FourBands";
import { ClosingBlock } from "../ClosingBlock";

describe("HowItRuns", () => {
  it("shows the four step numbers", () => {
    render(<HowItRuns />);
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("02")).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
    expect(screen.getByText("04")).toBeTruthy();
  });
});

describe("FourBands", () => {
  it("renders four band cards", () => {
    render(<FourBands />);
    expect(screen.getByText("LOW")).toBeTruthy();
    expect(screen.getByText("MODERATE")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByText("CRITICAL")).toBeTruthy();
  });

  it("ink-fills the CRITICAL card with its exact copy", () => {
    const { container } = render(<FourBands />);
    const criticalCard = container.querySelector('[data-band-card="CRITICAL"]');
    expect(criticalCard).toBeTruthy();
    expect(criticalCard?.getAttribute("data-ink")).toBe("true");
    expect(
      screen.getByText("Reserved for money already requested or documents already sent."),
    ).toBeTruthy();
  });
});

describe("ClosingBlock", () => {
  it("renders a sample finding carrying the provenance label", () => {
    render(<ClosingBlock />);
    expect(
      screen.getByText("Based on the conversation you shared — we can't independently verify it."),
    ).toBeTruthy();
  });

  it("renders the CHECK A JOB NOW button", () => {
    render(<ClosingBlock />);
    expect(screen.getByRole("button", { name: "CHECK A JOB NOW" })).toBeTruthy();
  });
});
