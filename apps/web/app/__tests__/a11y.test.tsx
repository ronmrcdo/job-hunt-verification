// Targeted accessibility contract tests (Task 6.2). These lock in the a11y
// contracts from the task brief: keyboard operability of the Tooltip and
// VerifyChecklist, aria-controls/id wiring on Tooltip + FindingCard, the
// band banner conveying band/confidence as text, and DefangedText being
// inert (no tab stop, no anchor). Full a11y-auditor sweep runs separately.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tooltip } from "../../components/ui/Tooltip";
import { FindingCard } from "../../components/report/FindingCard";
import { VerifyChecklist } from "../../components/report/VerifyChecklist";
import { BandBanner } from "../../components/report/BandBanner";
import { DefangedText } from "../../components/ui/DefangedText";
import { toReportViewModel } from "../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../lib/__fixtures__/sample-high";

describe("a11y: Tooltip", () => {
  it("trigger carries aria-expanded/aria-controls pointing at the panel's id", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(controlsId as string);
    expect(panel).not.toBeNull();
    expect(panel).toHaveTextContent("Details here");
  });

  it("pressing Enter on the focused trigger toggles it open, then closed", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    trigger.focus();

    // focus already opens the panel (existing contract) — Escape first so
    // Enter is exercised from a genuinely closed state.
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Details here")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("pressing Space on the focused trigger toggles it open", () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(trigger, { key: " " });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Details here")).toBeInTheDocument();
  });

  it("closes on Escape (panel is removed once the exit animation resolves)", async () => {
    render(<Tooltip label="Confidence explanation">Details here</Tooltip>);
    const trigger = screen.getByRole("button", { name: "Confidence explanation" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("Details here")).not.toBeInTheDocument());
  });
});

describe("a11y: FindingCard toggle", () => {
  it("toggle is a real <button> whose aria-controls matches the expanded region's id", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const finding = vm.groups.flatMap((g) => g.findings).find((f) => f.recordId === "F-03")!;
    render(<FindingCard finding={finding} />);

    const toggle = screen.getByRole("button");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const controlsId = toggle.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const region = document.getElementById(controlsId as string);
    expect(region).not.toBeNull();
  });
});

describe("a11y: VerifyChecklist items", () => {
  it("an item is reachable as role=checkbox and toggles aria-checked on Space", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<VerifyChecklist items={vm.verifyChecklist} />);

    const first = screen.getAllByRole("checkbox")[0];
    expect(first).toHaveAttribute("aria-checked", "false");

    first.focus();
    fireEvent.keyDown(first, { key: " ", code: "Space" });
    expect(first).toHaveAttribute("aria-checked", "true");
  });
});

describe("a11y: band banner conveys band + confidence as text", () => {
  it("renders the band title and a textual confidence word, not color alone", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<BandBanner vm={vm} confidenceSlot={<div>MEDIUM</div>} />);

    // Band conveyed as text (e.g. "HIGH RISK"), independent of the marker color.
    expect(screen.getByText("HIGH RISK")).toBeInTheDocument();
    // Confidence conveyed as a text word via the slot, not a color swatch alone.
    expect(screen.getByText("MEDIUM")).toBeInTheDocument();
  });
});

describe("a11y: DefangedText is inert", () => {
  it("renders a plain span with no anchor and no tab stop", () => {
    const { container } = render(<DefangedText value="http://evil.example.com/apply" />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(span).not.toHaveAttribute("tabindex");
  });
});
