import { describe, it, expect } from "vitest";
import { toReportViewModel } from "../report-view-model";
import { SAMPLE_HIGH } from "../__fixtures__/sample-high";
import { SAMPLE_LOW } from "../__fixtures__/sample-low";

describe("toReportViewModel", () => {
  it("maps the HIGH fixture", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);

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
    const vm = toReportViewModel(SAMPLE_LOW.inv, SAMPLE_LOW.submitted);

    expect(vm.groups.find((g) => g.key === "suspicious")).toBeUndefined();
    expect(vm.confidence).toBe("High");
    expect(vm.bandIndex).toBe(1);
  });
});
