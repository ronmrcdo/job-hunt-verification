import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ReportRail } from "../ReportRail";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";
import { FlowProvider } from "../../../lib/flow-context";

function renderRail(id = "abc-123", onReport = vi.fn()) {
  const vm = toReportViewModel(SAMPLE_HIGH.inv);
  return render(
    <FlowProvider>
      <ReportRail vm={vm} investigationId={id} reported={false} onReport={onReport} />
    </FlowProvider>,
  );
}

describe("ReportRail — report an issue", () => {
  it("offers a Report an issue action, not Copy link and not a Save action", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: /save this report/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /report an issue with this assessment/i }),
    ).toBeInTheDocument();
  });

  it("acknowledges the report and calls onReport once", async () => {
    const onReport = vi.fn();
    renderRail("abc-123", onReport);

    await userEvent.click(
      screen.getByRole("button", { name: /report an issue with this assessment/i }),
    );

    expect(onReport).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("Thanks — we'll look at it")).toBeInTheDocument();
    });
  });

  it("still offers the check-another action", () => {
    renderRail();
    expect(screen.getByRole("button", { name: /check another posting/i })).toBeInTheDocument();
  });

  // Issue 3: the aside is a grid item, so without self-start its border
  // stretches to the full height of the findings column beside it — the box
  // "eats" the whole page instead of wrapping its own content.
  it("pins itself to the top of its grid row rather than stretching", () => {
    const { container } = renderRail();
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("self-start");
  });
});
