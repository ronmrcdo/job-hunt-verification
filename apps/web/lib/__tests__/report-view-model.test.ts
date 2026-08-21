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

  it("derives submitted rows from inv.submission and inv.entities, not a passed-in argument", () => {
    // Row composition and ordering are pinned in product-rules.test.tsx; this
    // just checks the Email row still round-trips from `submission` verbatim.
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(vm.submitted).toContainEqual({ label: "Company", value: "Acme Global" });
    expect(vm.submitted).toContainEqual({
      label: "Email",
      value: "acmeglobalcareers@gmail.com",
      mono: true,
    });
  });

  it("omits a submitted row entirely when neither submission nor entities name it", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "some posting" },
      entities: null,
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

describe("bandMeaning is derived from the findings, not hardcoded", () => {
  const withFindings = (
    band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
    directions: ("legitimizing" | "suspicious" | "unverifiable")[],
  ) => ({
    ...SAMPLE_LOW.inv,
    assessment: { ...SAMPLE_LOW.inv.assessment!, band },
    findings: directions.map((direction, i) => ({
      id: `f-${i}`,
      category: "job" as const,
      direction,
      severity: "low" as const,
      claim: `claim ${i}`,
      source_ids: [],
      provenance: "web_verified" as const,
      mitigation: null,
    })),
  });

  it("does not claim nothing matches while a suspicious finding is listed", () => {
    // Case CE710EBD: the LOW banner read "Nothing here matches the scam
    // patterns we check for" directly above a "WHAT LOOKS SUSPICIOUS · 01"
    // section.
    const vm = toReportViewModel(withFindings("LOW", ["suspicious", "unverifiable"]));
    expect(vm.bandMeaning).not.toMatch(/nothing here matches/i);
  });

  it("still says nothing matches when nothing actually does", () => {
    const vm = toReportViewModel(withFindings("LOW", ["legitimizing"]));
    expect(vm.bandMeaning).toMatch(/nothing here matches/i);
  });

  it("counts the unverified findings instead of hardcoding two", () => {
    const vm = toReportViewModel(withFindings("LOW", ["unverifiable", "unverifiable", "unverifiable"]));
    expect(vm.bandMeaning).toMatch(/three things below stayed unverified/i);
    expect(vm.bandMeaning).not.toMatch(/two things/i);
  });

  it("singularizes a lone unverified finding", () => {
    const vm = toReportViewModel(withFindings("LOW", ["unverifiable"]));
    expect(vm.bandMeaning).toMatch(/one thing below stayed unverified/i);
  });

  it("omits the unverified caveat when everything was checked", () => {
    const vm = toReportViewModel(withFindings("LOW", ["legitimizing", "legitimizing"]));
    expect(vm.bandMeaning).not.toMatch(/unverified/i);
  });

  it("does not say multiple signals when a HIGH band rests on one", () => {
    const vm = toReportViewModel(withFindings("HIGH", ["suspicious"]));
    expect(vm.bandMeaning).not.toMatch(/multiple signals/i);
    expect(vm.bandMeaning).toMatch(/one signal/i);
  });
});

describe("user-provided provenance names the right artefact", () => {
  // The pasted job posting is a citable `kind: "user_provided"` source
  // (id src_det_posting, built by the API's evidence_assembly). Since the
  // analysis node stopped stamping every finding `web_verified`, findings
  // resting only on that posting reach the report as
  // `user_provided_unverified` — and the disclosure sentence, written for
  // V1's conversation paste, would have told the user we couldn't verify a
  // conversation they never shared.
  const postingBacked = () => ({
    ...SAMPLE_LOW.inv,
    sources: [
      {
        id: "src_det_posting",
        url: null,
        kind: "user_provided" as const,
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "Submitted job posting text: pay a $200 training fee",
        raw_excerpt: "pay a $200 training fee",
      },
    ],
    findings: [
      {
        id: "f-1",
        category: "job" as const,
        direction: "suspicious" as const,
        severity: "critical" as const,
        claim: "The posting demands a $200 training fee",
        source_ids: ["src_det_posting"],
        provenance: "user_provided_unverified" as const,
        mitigation: null,
      },
    ],
  });

  it("attributes a posting-backed finding to the posting, not a conversation", () => {
    const finding = toReportViewModel(postingBacked()).groups[0].findings[0];
    expect(finding.provenanceLabel).toBe(
      "Based on the posting text you submitted — we can't independently verify it.",
    );
  });

  it("names the posting source for what it is", () => {
    const finding = toReportViewModel(postingBacked()).groups[0].findings[0];
    expect(finding.sources[0].name).toBe("posting you submitted");
  });

  it("keeps the mandated conversation sentence for conversation-backed findings", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const critical = vm.groups.flatMap((g) => g.findings).find((f) => f.severity === "critical")!;
    expect(critical.provenanceLabel).toBe(
      "Based on the conversation you shared — we can't independently verify it.",
    );
  });
});

describe("submitted rows: the posting URL", () => {
  // job_url is captured by NewCheckForm and stored on the submission, but
  // was never surfaced anywhere in the report — the one submitted field the
  // user can see in the form and then never see again.
  it("surfaces job_url as a mono Posting row", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { ...SAMPLE_HIGH.inv.submission, job_url: "https://jobs.example.com/22220" },
    });

    expect(vm.submitted).toContainEqual({
      label: "Posting",
      value: "https://jobs.example.com/22220",
      mono: true,
    });
  });

  it("omits the Posting row when no job_url was submitted", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "some posting" },
    });

    expect(vm.submitted.map((r) => r.label)).not.toContain("Posting");
  });
});
