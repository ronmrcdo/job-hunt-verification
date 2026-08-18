// Product-rule guardrail suite (Task 2.6). Locks the report adapter's
// data-layer guarantees against the fixtures, independent of any rendered
// component. Task 3.6 extends this file to the assembled, rendered report
// tree (full-tree assertions, not just the VM).
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { toReportViewModel } from "../report-view-model";
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
  return render(
    <FlowProvider>
      <BandBanner vm={vm} confidenceSlot={<ConfidencePanel vm={vm} />} />
      {vm.groups.map((group) => (
        <FindingGroup key={group.key} group={group} />
      ))}
      <VerifyChecklist items={vm.verifyChecklist} />
      <ReportFooter vm={vm} onReport={() => {}} reported={false} />
    </FlowProvider>,
  );
}

describe("product rules: band vs. confidence vs. score", () => {
  it("HIGH vm's band is one of the four literals, with no numeric-score field anywhere on the VM", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);

    expect(["LOW", "MODERATE", "HIGH", "CRITICAL"]).toContain(vm.band);
    expect(vm).not.toHaveProperty("score");
    expect(vm).not.toHaveProperty("grade");
    expect(vm).not.toHaveProperty("percent");
  });

  it("HIGH vm's confidence is a separate value/space from band", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);

    expect(["Low", "Medium", "High"]).toContain(vm.confidence);
    expect(vm.confidence).not.toBe(vm.band);
  });
});

describe("product rules: unverifiable findings are neutral, not alarming", () => {
  it("every unverifiable finding's metaLine starts with UNVERIFIED, never WARNING", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
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
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
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
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
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
    const vm = toReportViewModel(SAMPLE_LOW.inv, SAMPLE_LOW.submitted);

    expect(vm.groups.map((g) => g.heading)).not.toContain("What looks suspicious");
    expect(vm.groups.find((g) => g.key === "suspicious")).toBeUndefined();
  });
});

describe("product rules: metaLine composition (severity 'info' is omitted, exact strings pinned)", () => {
  it("a legitimizing info-severity finding's metaLine omits SEVERITY INFO and starts with SUPPORTS LEGITIMACY", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const legitimizingFinding = vm.groups.find((g) => g.key === "legitimizing")!.findings[0];

    expect(legitimizingFinding.severity).toBe("info");
    expect(legitimizingFinding.metaLine).not.toContain("SEVERITY INFO");
    expect(legitimizingFinding.metaLine.startsWith("SUPPORTS LEGITIMACY")).toBe(true);
    // F-01: legitimizing/info, 2 sources (s-hi-01, s-hi-02) -> severity segment omitted.
    expect(legitimizingFinding.metaLine).toBe("SUPPORTS LEGITIMACY · 2 SOURCES");
  });

  it("pins the exact metaLine for the suspicious critical finding (F-04, training-fee)", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const criticalFinding = vm.groups
      .flatMap((g) => g.findings)
      .find((f) => f.severity === "critical")!;

    // direction: suspicious, severity: critical, 1 source (s-hi-07).
    expect(criticalFinding.metaLine).toBe("SUSPICIOUS · SEVERITY CRITICAL · 1 SOURCES");
  });
});

describe("product rules: submitted rows reflect only present fields", () => {
  // Note: the Task 2.6 brief expected the adapter to leave `contactChannel`
  // unmapped, citing "V0" as the reason. That's a stale assumption carried
  // over from a *different* decision (Task 2.5: flow-context.tsx no longer
  // derives `contactChannel` from a submitted website URL, because a URL
  // isn't a channel name — see task-2.5-report.md). The adapter itself
  // (report-view-model.ts) has always mapped `contactChannel` when present
  // on `Submitted`, and SAMPLE_HIGH.submitted legitimately sets it to
  // "Telegram" (task-2.1-report.md confirms the intended row order Job ->
  // Company -> Recruiter -> Contact channel -> Email). So this asserts the
  // row IS present for HIGH, not absent — the brief's expectation was wrong,
  // not the adapter.
  it("HIGH vm.submitted has the expected labels/values, including the mapped Contact-channel row", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);

    expect(vm.submitted).toContainEqual({ label: "Company", value: "Acme Global" });
    expect(vm.submitted).toContainEqual({
      label: "Email",
      value: "acmeglobalcareers@gmail.com",
      mono: true,
    });
    expect(vm.submitted).toContainEqual({ label: "Contact channel", value: "Telegram" });
  });

  it("a vm built without a submitted argument has an empty submitted array", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(vm.submitted).toEqual([]);
  });
});

describe("product rules: source label falls back to kind when there is no URL", () => {
  it("resolves url:null sources to their kind label", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
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
    const vm = toReportViewModel(sample.inv, sample.submitted);
    const { container } = renderAssembledReport(vm);

    expect(container.querySelector("a[href]")).toBeNull();
  });
});

describe("product rules (rendered tree, Task 3.6): band, never a numeric grade", () => {
  it.each([
    ["HIGH", SAMPLE_HIGH],
    ["LOW", SAMPLE_LOW],
  ])("%s report renders no numeric-grade text and no 'score' word", (_label, sample) => {
    const vm = toReportViewModel(sample.inv, sample.submitted);
    const { container } = renderAssembledReport(vm);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    expect(text).not.toMatch(/score/i);
  });
});

describe("product rules (rendered tree, Task 3.6): provenance label count", () => {
  it("HIGH report renders exactly one provenance label; LOW renders zero", () => {
    const highVm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const { container: highContainer } = renderAssembledReport(highVm);
    const provenanceText = "Based on the conversation you shared — we can't independently verify it.";
    const highMatches = Array.from(highContainer.querySelectorAll("div")).filter(
      (el) => el.textContent === provenanceText,
    );
    expect(highMatches).toHaveLength(1);

    const lowVm = toReportViewModel(SAMPLE_LOW.inv, SAMPLE_LOW.submitted);
    const { container: lowContainer } = renderAssembledReport(lowVm);
    const lowMatches = Array.from(lowContainer.querySelectorAll("div")).filter(
      (el) => el.textContent === provenanceText,
    );
    expect(lowMatches).toHaveLength(0);
  });
});

describe("product rules (rendered tree, Task 3.6): unverifiable markers are neutral, not alarming", () => {
  // Rule #6 neutrality is enforced at the row level (data-row-tone="neutral"
  // -> --color-neutral-row), not the small severity-marker dot: FindingCard
  // deliberately lets severity (critical/high/medium) win the dot color even
  // on an unverifiable-direction finding (see FindingCard.tsx's
  // severityMarker doc comment), so a medium-severity unverifiable finding's
  // dot can be the suspicious color — the row background is what must never
  // read as an alarm.
  it("every unverifiable FindingCard row carries data-row-tone=neutral with the neutral-row background, never critical/alarm", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const { container } = renderAssembledReport(vm);

    const unverifiableFindingIds = new Set(
      vm.groups.find((g) => g.key === "unverifiable")!.findings.map((f) => f.recordId),
    );
    expect(unverifiableFindingIds.size).toBeGreaterThan(0);

    const rows = container.querySelectorAll('[data-row-tone="neutral"]');
    expect(rows.length).toBe(unverifiableFindingIds.size);
    for (const row of rows) {
      expect((row as HTMLElement).style.background).toBe("var(--color-neutral-row)");
      expect(row.getAttribute("data-row-tone")).not.toBe("critical");
    }
  });
});
