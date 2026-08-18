import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfidencePanel } from "../ConfidencePanel";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";

describe("ConfidencePanel", () => {
  it("shows the confidence value, segments, and note", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<ConfidencePanel vm={vm} />);

    expect(screen.getByText("MEDIUM")).toBeTruthy();
    expect(screen.getByText(vm.confidenceNote)).toBeTruthy();
  });

  it("reveals the confidence explanation sentence when the tooltip is opened", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<ConfidencePanel vm={vm} />);

    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.click(trigger);

    // R8: Tooltip ENTER is synchronous under MotionGlobalConfig.skipAnimations — assert same-tick.
    expect(
      screen.getByText(
        "Confidence reflects how much we could verify — how many sources responded, how directly they addressed the claim, and how much rested on material we can't check independently.",
      ),
    ).toBeTruthy();
  });

  it("renders the submitted grid with Acme Global and a mono email", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<ConfidencePanel vm={vm} />);

    expect(screen.getByText("Acme Global")).toBeTruthy();
    const emailValue = screen.getByText(SAMPLE_HIGH.submitted.email);
    expect(emailValue.getAttribute("data-mono")).toBe("true");
  });

  it("renders no grid rows when submitted is empty", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const { container } = render(<ConfidencePanel vm={vm} />);

    expect(container.querySelectorAll("[data-submitted-row]")).toHaveLength(0);
  });

  it("never renders a link", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const { container } = render(<ConfidencePanel vm={vm} />);

    expect(container.querySelector("a[href]")).toBeNull();
  });
});
