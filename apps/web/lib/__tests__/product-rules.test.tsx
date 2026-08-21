// Product-rule guardrail suite (Task 2.6). Locks the report adapter's
// data-layer guarantees against the fixtures, independent of any rendered
// component. Task 3.6 extends this file to the assembled, rendered report
// tree (full-tree assertions, not just the VM).
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { toReportViewModel } from "../report-view-model";
import type { CompleteReportVM } from "../report-view-model";
import { SAMPLE_HIGH } from "../__fixtures__/sample-high";
import { SAMPLE_LOW } from "../__fixtures__/sample-low";
import { FlowProvider } from "../flow-context";
import { BandBanner } from "../../components/report/BandBanner";
import { ConfidencePanel } from "../../components/report/ConfidencePanel";
import { FindingGroup } from "../../components/report/FindingGroup";
import { VerifyChecklist } from "../../components/report/VerifyChecklist";
import { ReportFooter } from "../../components/report/ReportFooter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderAssembledReport(vm: ReturnType<typeof toReportViewModel>) {
  // Every fixture used with this helper (SAMPLE_HIGH/SAMPLE_LOW) carries a
  // real assessment, so the report is always complete — this cast is honest
  // for that reason, not a workaround.
  const completeVm = vm as CompleteReportVM;
  return render(
    <FlowProvider>
      <BandBanner vm={completeVm} confidenceSlot={<ConfidencePanel vm={completeVm} />} />
      {vm.groups.map((group) => (
        <FindingGroup key={group.key} group={group} />
      ))}
      <VerifyChecklist items={vm.verifyChecklist} />
      <ReportFooter vm={vm} />
    </FlowProvider>,
  );
}

describe("product rules: band vs. confidence vs. score", () => {
  it("HIGH vm's band is one of the four literals, with no numeric-score field anywhere on the VM", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(["LOW", "MODERATE", "HIGH", "CRITICAL"]).toContain(vm.band);
    expect(vm).not.toHaveProperty("score");
    expect(vm).not.toHaveProperty("grade");
    expect(vm).not.toHaveProperty("percent");
  });

  it("HIGH vm's confidence is a separate value/space from band", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(["Low", "Medium", "High"]).toContain(vm.confidence);
    expect(vm.confidence).not.toBe(vm.band);
  });
});

describe("product rules: unverifiable findings are neutral, not alarming", () => {
  it("every unverifiable finding's metaLine starts with UNVERIFIED, never WARNING", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const unverifiable = vm.groups.find((g) => g.key === "unverifiable")!.findings;

    expect(unverifiable.length).toBeGreaterThan(0);
    for (const finding of unverifiable) {
      expect(finding.metaLine.startsWith("UNVERIFIED")).toBe(true);
      expect(finding.metaLine).not.toContain("WARNING");
    }
  });
});

describe("product rules: provenance disclosure for user-supplied claims", () => {
  it("the critical finding's provenanceLabel is exactly the mandated sentence", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const criticalFinding = vm.groups
      .flatMap((g) => g.findings)
      .find((f) => f.severity === "critical")!;

    expect(criticalFinding).toBeDefined();
    expect(criticalFinding.provenanceLabel).toBe(
      "Based on the conversation you shared — we can't independently verify it.",
    );
  });
});

describe("product rules: defanged sources never carry a live scheme", () => {
  it("every SourceVM with defang:true has a name already defanged, with no bare http(s):// scheme", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const allSources = vm.groups.flatMap((g) => g.findings).flatMap((f) => f.sources);
    const defanged = allSources.filter((s) => s.defang === true);

    expect(defanged.length).toBeGreaterThan(0);
    for (const source of defanged) {
      expect(source.name).toContain("[.]");
      expect(source.name).not.toMatch(/https?:\/\//);
    }
  });
});

describe("product rules: empty groups are omitted, not rendered empty", () => {
  it("LOW vm has no 'What looks suspicious' group heading", () => {
    const vm = toReportViewModel(SAMPLE_LOW.inv);

    expect(vm.groups.map((g) => g.heading)).not.toContain("What looks suspicious");
    expect(vm.groups.find((g) => g.key === "suspicious")).toBeUndefined();
  });
});

describe("product rules: metaLine composition (severity 'info' is omitted, exact strings pinned)", () => {
  it("a legitimizing info-severity finding's metaLine omits SEVERITY INFO and starts with SUPPORTS LEGITIMACY", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const legitimizingFinding = vm.groups.find((g) => g.key === "legitimizing")!.findings[0];

    expect(legitimizingFinding.severity).toBe("info");
    expect(legitimizingFinding.metaLine).not.toContain("SEVERITY INFO");
    expect(legitimizingFinding.metaLine.startsWith("SUPPORTS LEGITIMACY")).toBe(true);
    // F-01: legitimizing/info, 2 sources (s-hi-01, s-hi-02) -> severity segment omitted.
    expect(legitimizingFinding.metaLine).toBe("SUPPORTS LEGITIMACY · 2 SOURCES");
  });

  it("pins the exact metaLine for the suspicious critical finding (F-04, training-fee)", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const criticalFinding = vm.groups
      .flatMap((g) => g.findings)
      .find((f) => f.severity === "critical")!;

    // direction: suspicious, severity: critical, 1 source (s-hi-07).
    expect(criticalFinding.metaLine).toBe("SUSPICIOUS · SEVERITY CRITICAL · 1 SOURCES");
  });
});

describe("product rules: submitted rows reflect only present fields", () => {
  // Task 8 (V1): `submitted` is now derived from the DB row's
  // `inv.submission` (Task 5's `Submission` type: job_text, company_name?,
  // recruiter_email?, job_url?) instead of a passed-in `Submitted` arg.
  // That type carries no recruiter-name or contact-channel field at all, so
  // "Contact channel" (and "Job"/"Recruiter") can never appear as a row —
  // only Company and Email round-trip.
  it("HIGH vm.submitted has the expected labels/values, and no Contact-channel row", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(vm.submitted).toContainEqual({ label: "Company", value: "Acme Global" });
    expect(vm.submitted).toContainEqual({
      label: "Email",
      value: "acmeglobalcareers@gmail.com",
      mono: true,
    });
    expect(vm.submitted.map((r) => r.label)).not.toContain("Contact channel");
  });

  it("a vm built from a submission with no company_name/recruiter_email has an empty submitted array", () => {
    const vm = toReportViewModel({ ...SAMPLE_HIGH.inv, submission: { job_text: "x" } });

    expect(vm.submitted).toEqual([]);
  });
});

describe("product rules: source label falls back to kind when there is no URL", () => {
  it("resolves url:null sources to their kind label", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);
    const allSources = vm.groups.flatMap((g) => g.findings).flatMap((f) => f.sources);

    // s-hi-02 (whois, url:null) is attached to F-01.
    expect(allSources.some((s) => s.name === "registrar record")).toBe(true);
    // s-hi-09 (dns, url:null) is attached to F-05.
    expect(allSources.some((s) => s.name === "mail records")).toBe(true);
    // s-hi-07 (user_provided, url:null) is attached to F-04.
    expect(allSources.some((s) => s.name === "conversation you shared")).toBe(true);
  });
});

describe("product rules (rendered tree, Task 3.6): no <a href> anywhere in the assembled report", () => {
  it.each([
    ["HIGH", SAMPLE_HIGH],
    ["LOW", SAMPLE_LOW],
  ])("%s report has zero <a href> in the whole rendered document", (_label, sample) => {
    const vm = toReportViewModel(sample.inv);
    const { container } = renderAssembledReport(vm);

    expect(container.querySelector("a[href]")).toBeNull();
  });
});

describe("product rules (rendered tree, Task 3.6): band, never a numeric grade", () => {
  it.each([
    ["HIGH", SAMPLE_HIGH],
    ["LOW", SAMPLE_LOW],
  ])("%s report renders no numeric-grade text and no 'score' word", (_label, sample) => {
    const vm = toReportViewModel(sample.inv);
    const { container } = renderAssembledReport(vm);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    expect(text).not.toMatch(/score/i);
  });
});

describe("product rules (rendered tree, Task 3.6): provenance label count", () => {
  it("HIGH report renders exactly one provenance label; LOW renders zero", () => {
    const highVm = toReportViewModel(SAMPLE_HIGH.inv);
    const { container: highContainer } = renderAssembledReport(highVm);
    const provenanceText = "Based on the conversation you shared — we can't independently verify it.";
    const highMatches = Array.from(highContainer.querySelectorAll("div")).filter(
      (el) => el.textContent === provenanceText,
    );
    expect(highMatches).toHaveLength(1);

    const lowVm = toReportViewModel(SAMPLE_LOW.inv);
    const { container: lowContainer } = renderAssembledReport(lowVm);
    const lowMatches = Array.from(lowContainer.querySelectorAll("div")).filter(
      (el) => el.textContent === provenanceText,
    );
    expect(lowMatches).toHaveLength(0);
  });
});

describe("product rules (rendered tree, Task 3.6): unverifiable markers are neutral, not alarming", () => {
  // Rule #6 (authoritative): the unverifiable group must read as visually
  // NEUTRAL — a grey MARKER, light-grey background, never a warning. This
  // constrains FindingCard's severityMarker(): direction === "unverifiable"
  // wins the marker-dot color (var(--color-muted), data-severity="unverified")
  // even when the finding also carries a high/medium severity — severity is
  // only allowed to win the dot for critical findings. The row background
  // (data-row-tone="neutral" -> --color-neutral-row) is a supplementary,
  // non-alarming check, not a substitute for the marker guarantee.
  it.each([
    ["HIGH", SAMPLE_HIGH],
    ["LOW", SAMPLE_LOW],
  ])("%s report: every unverifiable finding's marker dot is grey/muted, and its row is neutral", (_label, sample) => {
    const vm = toReportViewModel(sample.inv);
    const { container } = renderAssembledReport(vm);

    const unverifiableFindingIds = new Set(
      vm.groups.find((g) => g.key === "unverifiable")!.findings.map((f) => f.recordId),
    );
    expect(unverifiableFindingIds.size).toBeGreaterThan(0);

    const markers = container.querySelectorAll('[data-severity="unverified"]');
    expect(markers.length).toBe(unverifiableFindingIds.size);
    for (const marker of markers) {
      expect((marker as HTMLElement).style.background).toBe("var(--color-muted)");
    }

    const rows = container.querySelectorAll('[data-row-tone="neutral"]');
    expect(rows.length).toBe(unverifiableFindingIds.size);
    for (const row of rows) {
      // Resting tint is applied via a Tailwind class (not inline style) so
      // hover:bg-surface-soft can still win — see FindingCard's rowTone.
      expect(row).toHaveClass("bg-neutral-row");
      expect(row.getAttribute("data-row-tone")).not.toBe("critical");
    }
  });
});
