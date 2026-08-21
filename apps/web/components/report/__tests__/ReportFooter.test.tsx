import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportFooter } from "../ReportFooter";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";

function renderFooter() {
  const vm = toReportViewModel(SAMPLE_HIGH.inv);
  return render(<ReportFooter vm={vm} />);
}

describe("ReportFooter", () => {
  it("renders the exact non-legal-determination scope note", () => {
    renderFooter();

    expect(
      screen.getByText(
        "This assessment reflects what we could find and verify online. It is not a legal determination.",
      ),
    ).toBeTruthy();
  });

  it("renders a mono case stamp line", () => {
    const { container } = renderFooter();

    expect(container.querySelector(".font-mono")?.textContent).toContain(
      toReportViewModel(SAMPLE_HIGH.inv).caseId,
    );
  });

  // Both actions moved to ReportRail so each exists exactly once in the
  // report; the footer is a meta strip now, not a second control surface.
  it("no longer duplicates the rail's report / check-another controls", () => {
    renderFooter();

    expect(screen.queryByText("REPORT AN ISSUE WITH THIS ASSESSMENT")).toBeNull();
    expect(screen.queryByRole("button", { name: /check another posting/i })).toBeNull();
  });
});
