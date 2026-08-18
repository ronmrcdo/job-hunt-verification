import { describe, expect, it } from "vitest";
import { formatStamp, formatCaseStamp, pad2 } from "../format";

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
