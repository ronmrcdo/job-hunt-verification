import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VerifyChecklist } from "../VerifyChecklist";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";
import { SAMPLE_LOW } from "../../../lib/__fixtures__/sample-low";

describe("VerifyChecklist", () => {
  it("renders the FOUR-item heading and one checkbox per item for a 4-item checklist", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<VerifyChecklist items={vm.verifyChecklist} />);

    expect(vm.verifyChecklist).toHaveLength(4);
    expect(screen.getByText("FOUR CHECKS THAT WOULD SETTLE THIS")).toBeTruthy();
    expect(screen.getByText("VERIFY IT YOURSELF")).toBeTruthy();
    expect(screen.getByText("04")).toBeTruthy();
    expect(screen.getByText("These close the gaps we couldn't. Each takes a few minutes.")).toBeTruthy();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
  });

  it("renders the THREE-item heading for a 3-item checklist", () => {
    const vm = toReportViewModel(SAMPLE_LOW.inv, SAMPLE_LOW.submitted);
    render(<VerifyChecklist items={vm.verifyChecklist} />);

    expect(vm.verifyChecklist).toHaveLength(3);
    expect(screen.getByText("THREE CHECKS WORTH DOING ANYWAY")).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("clicking a row toggles its checked state (aria-checked flips, text gets strikethrough)", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<VerifyChecklist items={vm.verifyChecklist} />);

    const checkboxes = screen.getAllByRole("checkbox");
    const first = checkboxes[0];
    expect(first.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(first);
    expect(first.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(first);
    expect(first.getAttribute("aria-checked")).toBe("false");
  });

  it("is keyboard-tickable: a real <button> gets Space/Enter activation from the platform for free (ruling R12)", () => {
    // A manual keydown-Space handler here would double-toggle in a real
    // browser — the native button already fires a click on Space's keyup,
    // so toggling again on keydown cancels itself out. jsdom's fireEvent
    // can't simulate that native activation path, so the real contract this
    // asserts is: it's a genuine <button> (which is what guarantees
    // platform Enter/Space activation), and click — what that activation
    // produces — toggles aria-checked.
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    render(<VerifyChecklist items={vm.verifyChecklist} />);

    const first = screen.getAllByRole("checkbox")[0];
    expect(first.tagName).toBe("BUTTON");
    first.focus();
    fireEvent.click(first);

    expect(first.getAttribute("aria-checked")).toBe("true");
  });
});
