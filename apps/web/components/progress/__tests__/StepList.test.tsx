import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StepList } from "../StepList";

function rowFor(title: string) {
  return screen.getByText(title).closest("[data-step-state]") as HTMLElement;
}

describe("StepList", () => {
  it("derives row state from doneSteps and completion order, not display order", () => {
    render(<StepList doneSteps={[1, 3]} caseId="4F2C-1180" />);

    const step1 = rowFor("Reading the posting");
    expect(step1.getAttribute("data-step-state")).toBe("done");
    expect(within(step1).getByText("Closed")).toBeTruthy();

    const step3 = rowFor("Checking the company's web presence");
    expect(step3.getAttribute("data-step-state")).toBe("soft");
    expect(within(step3).getByText("Soft close")).toBeTruthy();

    // Completion order is 1, 3, 4, 2, 5, 6, 7 — with 1 and 3 done, step 4 is
    // the next to close, so it's "running" even though step 2 sits earlier
    // in display order.
    const step4 = rowFor("Searching for duplicate postings");
    expect(step4.getAttribute("data-step-state")).toBe("running");
    expect(within(step4).getByText("Open")).toBeTruthy();

    const step2 = rowFor("Checking domain records");
    expect(step2.getAttribute("data-step-state")).toBe("queued");
    expect(within(step2).getByText("Queued")).toBeTruthy();

    const step7 = rowFor("Writing your report");
    expect(step7.getAttribute("data-step-state")).toBe("queued");
  });

  it("renders the case header with the count of closed steps", () => {
    render(<StepList doneSteps={[1, 3]} caseId="4F2C-1180" />);

    expect(screen.getByText("CASE 4F2C-1180 · 2 of 7 steps closed")).toBeTruthy();
  });
});
