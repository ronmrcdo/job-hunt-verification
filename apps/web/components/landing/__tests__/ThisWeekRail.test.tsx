import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
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

  it("never flashes a delta on the first load — there is no prior value to have moved from", async () => {
    render(<ThisWeekRail />);
    await waitFor(() => expect(screen.getByText("4,118")).toBeTruthy());
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.queryByText("✓")).toBeNull();
  });

  it("flashes a signed delta and a check when a later poll shows growth", async () => {
    vi.useFakeTimers();
    try {
      publicStats
        .mockResolvedValueOnce({ postingsChecked: 4118, findingsWithSourcesPct: 96, medianSeconds: 100 })
        .mockResolvedValueOnce({ postingsChecked: 4120, findingsWithSourcesPct: 96, medianSeconds: 100 });
      render(<ThisWeekRail />);
      await vi.advanceTimersByTimeAsync(0); // first fetch resolves — no flash
      expect(screen.queryByText(/^\+/)).toBeNull();

      await vi.advanceTimersByTimeAsync(20_000); // second poll — +2 postings
      expect(screen.getByText("+2")).toBeTruthy();
      expect(screen.getByText("✓")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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
