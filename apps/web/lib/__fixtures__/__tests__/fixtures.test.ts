import { describe, it, expect } from "vitest";
import { SAMPLE_HIGH } from "../sample-high";
import { SAMPLE_LOW } from "../sample-low";

describe("SAMPLE_HIGH fixture", () => {
  it("has 7 findings split 2 legitimizing / 3 suspicious / 2 unverifiable", () => {
    const findings = SAMPLE_HIGH.inv.findings;
    expect(findings).toHaveLength(7);
    expect(findings.filter((f) => f.direction === "legitimizing")).toHaveLength(2);
    expect(findings.filter((f) => f.direction === "suspicious")).toHaveLength(3);
    expect(findings.filter((f) => f.direction === "unverifiable")).toHaveLength(2);
  });

  it("has exactly one user_provided_unverified finding at critical severity", () => {
    const matches = SAMPLE_HIGH.inv.findings.filter(
      (f) => f.provenance === "user_provided_unverified" && f.severity === "critical",
    );
    expect(matches).toHaveLength(1);
  });

  it("has exactly one finding whose mitigation mentions Cross-posting", () => {
    const matches = SAMPLE_HIGH.inv.findings.filter(
      (f) => f.mitigation && f.mitigation.includes("Cross-posting"),
    );
    expect(matches).toHaveLength(1);
  });

  it("has the expected assessment", () => {
    const a = SAMPLE_HIGH.inv.assessment;
    expect(a?.band).toBe("HIGH");
    expect(a?.confidence).toBe("MODERATE");
    expect(a?.coverage).toBe(0.6);
  });

  it("has check_count 3 and 4 items to verify", () => {
    expect(SAMPLE_HIGH.inv.check_count).toBe(3);
    expect(SAMPLE_HIGH.inv.what_to_verify).toHaveLength(4);
  });
});

describe("SAMPLE_LOW fixture", () => {
  it("has 5 findings with zero suspicious", () => {
    const findings = SAMPLE_LOW.inv.findings;
    expect(findings).toHaveLength(5);
    expect(findings.filter((f) => f.direction === "suspicious")).toHaveLength(0);
  });

  it("has the expected assessment", () => {
    const a = SAMPLE_LOW.inv.assessment;
    expect(a?.band).toBe("LOW");
    expect(a?.confidence).toBe("HIGH");
    expect(a?.coverage).toBe(0.9);
  });

  it("has a null check_count", () => {
    expect(SAMPLE_LOW.inv.check_count).toBeNull();
  });
});
