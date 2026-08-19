import { describe, it, expect } from "vitest";
import { toReportViewModel } from "../report-view-model";
import { SAMPLE_HIGH } from "../__fixtures__/sample-high";
import { SAMPLE_LOW } from "../__fixtures__/sample-low";

describe("toReportViewModel", () => {
  it("maps the HIGH fixture", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(vm.band).toBe("HIGH");
    expect(vm.bandIndex).toBe(3);
    expect(vm.confidence).toBe("Medium");
    expect(vm.confidenceSegments).toBe(2);

    expect(vm.groups).toHaveLength(3);
    expect(vm.groups.map((g) => g.key)).toEqual(["legitimizing", "suspicious", "unverifiable"]);
    expect(vm.groups[0].countMono).toBe("02");
    expect(vm.groups[1].countMono).toBe("03");
    expect(vm.groups[2].countMono).toBe("02");

    const suspiciousGroup = vm.groups.find((g) => g.key === "suspicious")!;
    const criticalFinding = suspiciousGroup.findings.find((f) => f.severity === "critical")!;
    expect(criticalFinding).toBeDefined();
    expect(criticalFinding.provenanceLabel).not.toBeNull();
    expect(criticalFinding.severity).toBe("critical");

    const crossPostFinding = suspiciousGroup.findings.find((f) =>
      f.however?.includes("Cross-posting"),
    )!;
    expect(crossPostFinding).toBeDefined();
    expect(crossPostFinding.however).not.toBeNull();

    const allFindings = vm.groups.flatMap((g) => g.findings);
    expect(allFindings.map((f) => f.recordId)).toEqual([
      "F-01",
      "F-02",
      "F-03",
      "F-04",
      "F-05",
      "F-06",
      "F-07",
    ]);

    const legitimizingFinding = vm.groups.find((g) => g.key === "legitimizing")!.findings[0];
    expect(legitimizingFinding.metaLine.startsWith("SUPPORTS LEGITIMACY")).toBe(true);
  });

  it("maps the LOW fixture", () => {
    const vm = toReportViewModel(SAMPLE_LOW.inv);

    expect(vm.groups.find((g) => g.key === "suspicious")).toBeUndefined();
    expect(vm.confidence).toBe("High");
    expect(vm.bandIndex).toBe(1);
  });

  it("derives submitted rows from inv.submission, not a passed-in argument", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(vm.submitted).toContainEqual({ label: "Company", value: "Acme Global" });
    expect(vm.submitted).toContainEqual({
      label: "Email",
      value: "acmeglobalcareers@gmail.com",
      mono: true,
    });
    // Job title / recruiter / contact channel have no source field on
    // Submission, so they never appear as rows.
    expect(vm.submitted.map((r) => r.label)).not.toContain("Job");
    expect(vm.submitted.map((r) => r.label)).not.toContain("Recruiter");
    expect(vm.submitted.map((r) => r.label)).not.toContain("Contact channel");
  });

  it("omits a submitted row entirely when the corresponding submission field is absent", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "some posting" },
    });

    expect(vm.submitted).toEqual([]);
  });
});

function inv(overrides: any) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    status: "deadline_exceeded",
    submission: {},
    assessment: null,
    findings: [],
    sources: [],
    what_to_verify: [],
    check_count: null,
    ...overrides,
  } as any;
}

describe("toReportViewModel with a missing assessment", () => {
  it("does not fabricate a band", () => {
    const vm = toReportViewModel(inv({ assessment: null }));
    expect(vm.complete).toBe(false);
    expect(vm.band).toBeNull();
    expect(vm.confidence).toBeNull();
    expect(vm.summary).toBeNull();
  });

  it("stays complete when the assessment is present", () => {
    const vm = toReportViewModel(
      inv({ status: "done", assessment: { band: "LOW", confidence: "HIGH", summary: "ok" } }),
    );
    expect(vm.complete).toBe(true);
    expect(vm.band).toBe("LOW");
  });
});
