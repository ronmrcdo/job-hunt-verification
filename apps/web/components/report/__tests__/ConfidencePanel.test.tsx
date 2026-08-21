import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfidencePanel } from "../ConfidencePanel";
import { toReportViewModel } from "../../../lib/report-view-model";
import type { CompleteReportVM } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";
import type { Investigation } from "../../../lib/investigations";

// Every fixture used here carries a real assessment, so the report is
// always complete — this cast is honest for that reason, not a workaround.
function completeVM(inv: Investigation): CompleteReportVM {
  return toReportViewModel(inv) as CompleteReportVM;
}

describe("ConfidencePanel", () => {
  it("shows the confidence value, segments, and note", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    render(<ConfidencePanel vm={vm} />);

    expect(screen.getByText("MEDIUM")).toBeTruthy();
    expect(screen.getByText(vm.confidenceNote)).toBeTruthy();
  });

  it("reveals the confidence explanation sentence when the tooltip is opened", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
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
    const vm = completeVM(SAMPLE_HIGH.inv);
    render(<ConfidencePanel vm={vm} />);

    expect(screen.getByText("Acme Global")).toBeTruthy();
    const emailValue = screen.getByText(SAMPLE_HIGH.inv.submission.recruiter_email!);
    expect(emailValue.getAttribute("data-mono")).toBe("true");
  });

  it("renders no grid rows when neither the submission nor the entities name anything", () => {
    const vm = completeVM({ ...SAMPLE_HIGH.inv, submission: { job_text: "x" }, entities: null });
    const { container } = render(<ConfidencePanel vm={vm} />);

    expect(container.querySelectorAll("[data-submitted-row]")).toHaveLength(0);
  });

  it("renders the four prototype rows when the worker extracted them", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    const { container } = render(<ConfidencePanel vm={vm} />);

    expect(container.querySelectorAll("[data-submitted-row]").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("Virtual Assistant, $2,500/month")).toBeInTheDocument();
    expect(screen.getByText("John Smith · Telegram")).toBeInTheDocument();
  });

  it("never renders a link", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    const { container } = render(<ConfidencePanel vm={vm} />);

    expect(container.querySelector("a[href]")).toBeNull();
  });
});
