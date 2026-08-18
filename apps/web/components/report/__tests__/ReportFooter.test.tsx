import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportFooter } from "../ReportFooter";
import { FlowProvider } from "../../../lib/flow-context";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderFooter(onReport = vi.fn()) {
  const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
  return render(
    <FlowProvider>
      <ReportFooter vm={vm} onReport={onReport} reported={false} />
    </FlowProvider>,
  );
}

describe("ReportFooter", () => {
  it("shows the report control, and clicking it shows the thanks message and calls onReport", () => {
    const onReport = vi.fn();
    renderFooter(onReport);

    const reportButton = screen.getByText("REPORT AN ISSUE WITH THIS ASSESSMENT");
    fireEvent.click(reportButton);

    expect(screen.getByText("Thanks — we'll look at it")).toBeTruthy();
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("renders the exact non-legal-determination scope note", () => {
    renderFooter();

    expect(
      screen.getByText(
        "This assessment reflects what we could find and verify online. It is not a legal determination.",
      ),
    ).toBeTruthy();
  });

  it("renders a mono case stamp line and a Check another posting control", () => {
    renderFooter();

    expect(screen.getByText("CHECK ANOTHER POSTING")).toBeTruthy();
  });
});
