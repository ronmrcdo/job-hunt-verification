import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const publicStats = vi.fn();
vi.mock("../../../lib/investigations", () => ({
  publicStats: (...a: any) => publicStats(...a),
}));
vi.mock("../../../lib/supabase/client", () => ({ createClient: () => ({}) }));

import { ThisWeekRail } from "../ThisWeekRail";

beforeEach(() => {
  vi.clearAllMocks();
  publicStats.mockResolvedValue({
    postingsChecked: 4118,
    findingsWithSourcesPct: 96,
    medianSeconds: 100,
  });
});

describe("ThisWeekRail", () => {
  it("renders the three live stats once they load", async () => {
    render(<ThisWeekRail />);
    await waitFor(() => expect(screen.getByText("4,118")).toBeTruthy());
    expect(screen.getByText("96%")).toBeTruthy();
    expect(screen.getByText("1m 40s")).toBeTruthy();
  });

  it("labels the rail 'So far' — the stats are all-time, not weekly", async () => {
    render(<ThisWeekRail />);
    expect(screen.getByText("So far")).toBeTruthy();
    expect(screen.queryByText("This week")).toBeNull();
  });

  it("carries the three stat labels", async () => {
    render(<ThisWeekRail />);
    expect(screen.getByText("Postings checked")).toBeTruthy();
    expect(screen.getByText("Findings with sources attached")).toBeTruthy();
    expect(screen.getByText("Median time to a report")).toBeTruthy();
  });

  it("shows placeholders before the stats resolve, never a fabricated number", () => {
    render(<ThisWeekRail />);
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("shows placeholders when the stats come back empty", async () => {
    publicStats.mockResolvedValue({
      postingsChecked: 0,
      findingsWithSourcesPct: null,
      medianSeconds: null,
    });
    render(<ThisWeekRail />);
    await waitFor(() => expect(screen.getByText("0")).toBeTruthy());
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("shows the exact won't-do copy regardless of the fetch", () => {
    render(<ThisWeekRail />);
    expect(
      screen.getByText(
        "We never stamp a posting a scam, never give it a score out of a hundred, and never link to a domain under investigation. You get a band, our confidence in it, and the evidence.",
      ),
    ).toBeTruthy();
  });
});
