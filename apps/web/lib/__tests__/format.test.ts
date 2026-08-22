import { describe, expect, it } from "vitest";
import { formatStamp, formatCaseStamp, pad2, formatCount, formatPercent, formatDuration, formatDelta } from "../format";

describe("pad2", () => {
  it("zero-pads a single digit", () => {
    expect(pad2(3)).toBe("03");
  });

  it("leaves a two-digit number unchanged", () => {
    expect(pad2(18)).toBe("18");
  });
});

describe("formatStamp", () => {
  it("contains the dd.mm.yyyy date derived from UTC, regardless of local TZ", () => {
    expect(formatStamp("2026-08-18T00:00:00Z")).toContain("18.08.2026");
  });

  it("is prefixed with 'Retrieved '", () => {
    expect(formatStamp("2026-08-18T00:00:00Z")).toBe("Retrieved 18.08.2026");
  });
});

describe("formatCaseStamp", () => {
  it("contains the dd.mm.yyyy date and the CASE id", () => {
    const out = formatCaseStamp("2026-08-18T00:00:00Z", "1234");
    expect(out).toContain("18.08.2026");
    expect(out).toContain("CASE 1234");
  });

  it("uses the ' · ' separator between date, time+zone, and case id", () => {
    const out = formatCaseStamp("2026-08-18T00:00:00Z", "1234");
    expect(out.split(" · ")).toHaveLength(3);
  });
});

// Landing-page stat formatting (the "So far" rail). Each helper takes the
// nullable RPC value directly and renders the em-dash placeholder for null,
// so the component never has to branch on missing data itself.
describe("formatCount", () => {
  it("groups thousands with commas", () => {
    expect(formatCount(4118)).toBe("4,118");
  });

  it("leaves values under a thousand ungrouped", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(42)).toBe("42");
  });

  it("renders an em dash for null", () => {
    expect(formatCount(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("appends a percent sign", () => {
    expect(formatPercent(96)).toBe("96%");
    expect(formatPercent(100)).toBe("100%");
  });

  it("renders an em dash for null", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("renders minutes and seconds above a minute", () => {
    expect(formatDuration(100)).toBe("1m 40s");
  });

  it("drops the minute part below a minute", () => {
    expect(formatDuration(40)).toBe("40s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("omits a zero seconds remainder", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("renders hours and minutes above an hour", () => {
    expect(formatDuration(3720)).toBe("1h 2m");
  });

  it("rounds fractional seconds", () => {
    expect(formatDuration(99.6)).toBe("1m 40s");
  });

  it("renders an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatDelta", () => {
  describe("count", () => {
    it("renders a grouped, signed increment", () => {
      expect(formatDelta(3, "count")).toBe("+3");
      expect(formatDelta(1200, "count")).toBe("+1,200");
    });

    it("shows nothing for a flat or negative count — postings only grow", () => {
      expect(formatDelta(0, "count")).toBeNull();
      expect(formatDelta(-2, "count")).toBeNull();
    });
  });

  describe("percent", () => {
    it("renders a signed point change either direction", () => {
      expect(formatDelta(2, "percent")).toBe("+2%");
      expect(formatDelta(-1, "percent")).toBe("-1%");
    });

    it("shows nothing when the change rounds away", () => {
      expect(formatDelta(0, "percent")).toBeNull();
      expect(formatDelta(0.4, "percent")).toBeNull();
    });
  });

  describe("duration", () => {
    it("reuses the duration formatter with a sign", () => {
      expect(formatDelta(40, "duration")).toBe("+40s");
      expect(formatDelta(-100, "duration")).toBe("-1m 40s");
    });

    it("shows nothing when the change rounds to zero", () => {
      expect(formatDelta(0, "duration")).toBeNull();
      expect(formatDelta(0.3, "duration")).toBeNull();
    });
  });
});
