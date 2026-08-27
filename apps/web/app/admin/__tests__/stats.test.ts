import { describe, it, expect } from "vitest";
import { toDashboardStats } from "../stats";

describe("toDashboardStats", () => {
  it("tallies verdicts and statuses, counting rows in total but ignoring unknown enum values", () => {
    const s = toDashboardStats({
      registeredUsers: 1284,
      investigationsTotal: 57,
      feedbackVerdicts: ["agree", "agree", "too_high", "too_low", "bogus"],
      candidateStatuses: ["promoted", "promoted", "exported", "???"],
    });
    expect(s.registeredUsers).toBe(1284);
    expect(s.investigationsTotal).toBe(57);
    expect(s.feedback).toEqual({ total: 5, agree: 2, too_high: 1, too_low: 1 });
    expect(s.candidates).toEqual({ total: 4, promoted: 2, exported: 1 });
  });

  it("returns all-zero tallies for empty arrays", () => {
    const s = toDashboardStats({ registeredUsers: 0, investigationsTotal: 0, feedbackVerdicts: [], candidateStatuses: [] });
    expect(s.feedback).toEqual({ total: 0, agree: 0, too_high: 0, too_low: 0 });
    expect(s.candidates).toEqual({ total: 0, promoted: 0, exported: 0 });
  });
});
