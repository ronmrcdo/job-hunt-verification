import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewGrid } from "../OverviewGrid";
import type { DashboardStats } from "../stats";

const STATS: DashboardStats = {
  registeredUsers: 1284,
  investigationsTotal: 57,
  feedback: { total: 9, agree: 5, too_high: 3, too_low: 1 },
  candidates: { total: 4, promoted: 3, exported: 1 },
};

describe("OverviewGrid", () => {
  it("renders every headline number, locale-formatted, with its label", () => {
    render(<OverviewGrid stats={STATS} />);
    expect(screen.getByText((1284).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("57")).toBeInTheDocument();
    expect(screen.getByText("Registered users")).toBeInTheDocument();
    expect(screen.getByText("Investigations")).toBeInTheDocument();
  });

  it("renders the verdict and status sub-counts", () => {
    render(<OverviewGrid stats={STATS} />);
    expect(screen.getByText(/agree 5 · too_high 3 · too_low 1/)).toBeInTheDocument();
    expect(screen.getByText(/promoted 3 · exported 1/)).toBeInTheDocument();
  });
});
