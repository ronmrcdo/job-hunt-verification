import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StepList } from "../StepList";
import type { InvestigationStep } from "../../../lib/investigations";

function rowFor(title: string) {
  return screen.getByText(title).closest("[data-step-state]") as HTMLElement;
}

function step(overrides: Partial<InvestigationStep>): InvestigationStep {
  return {
    investigation_id: "i",
    step_key: "x",
    label: "a step",
    display_order: 1,
    status: "pending",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe("StepList", () => {
  it("maps each real step row's status to the row's visual state", () => {
    const steps: InvestigationStep[] = [
      step({ step_key: "intake", label: "Reading the posting", display_order: 1, status: "done" }),
      step({ step_key: "domain", label: "Checking domain records", display_order: 2, status: "pending" }),
      step({
        step_key: "company",
        label: "Checking the company's web presence",
        display_order: 3,
        status: "skipped",
      }),
      step({
        step_key: "duplicates",
        label: "Searching for duplicate postings",
        display_order: 4,
        status: "running",
      }),
      step({ step_key: "report", label: "Writing your report", display_order: 5, status: "failed" }),
    ];

    render(<StepList steps={steps} caseId="4F2C-1180" />);

    const readIt = rowFor("Reading the posting");
    expect(readIt.getAttribute("data-step-state")).toBe("done");
    expect(within(readIt).getByText("Closed")).toBeTruthy();

    const domain = rowFor("Checking domain records");
    expect(domain.getAttribute("data-step-state")).toBe("queued");
    expect(within(domain).getByText("Queued")).toBeTruthy();

    const company = rowFor("Checking the company's web presence");
    expect(company.getAttribute("data-step-state")).toBe("soft");
    expect(within(company).getByText("Soft close")).toBeTruthy();

    const duplicates = rowFor("Searching for duplicate postings");
    expect(duplicates.getAttribute("data-step-state")).toBe("running");
    expect(within(duplicates).getByText("Open")).toBeTruthy();

    const report = rowFor("Writing your report");
    expect(report.getAttribute("data-step-state")).toBe("failed");
  });

  it("renders the case header with the count of done steps", () => {
    const steps: InvestigationStep[] = [
      step({ step_key: "a", label: "A", display_order: 1, status: "done" }),
      step({ step_key: "b", label: "B", display_order: 2, status: "done" }),
      step({ step_key: "c", label: "C", display_order: 3, status: "running" }),
    ];

    render(<StepList steps={steps} caseId="4F2C-1180" />);

    expect(screen.getByText("CASE 4F2C-1180 · 2 of 3 steps closed")).toBeTruthy();
  });

  it("renders rows in display_order regardless of array order", () => {
    const steps: InvestigationStep[] = [
      step({ step_key: "b", label: "Second", display_order: 2, status: "pending" }),
      step({ step_key: "a", label: "First", display_order: 1, status: "done" }),
    ];

    render(<StepList steps={steps} />);

    const rows = screen.getAllByText(/First|Second/);
    expect(rows.map((r) => r.textContent)).toEqual(["First", "Second"]);
  });
});
