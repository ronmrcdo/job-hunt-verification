import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FindingCard } from "../FindingCard";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";
import type { FindingVM } from "../../../lib/report-view-model";

function findingsById(): Map<string, FindingVM> {
  const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
  const all = vm.groups.flatMap((g) => g.findings);
  return new Map(all.map((f) => [f.recordId, f]));
}

describe("FindingCard", () => {
  it("collapsed: shows recordId, metaLine, and a closed toggle", () => {
    const finding = findingsById().get("F-04")!;
    render(<FindingCard finding={finding} />);

    expect(screen.getByText("F-04")).toBeTruthy();
    expect(screen.getByText(finding.metaLine)).toBeTruthy();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the critical finding's provenance sentence without expanding (product rule #5)", () => {
    const finding = findingsById().get("F-04")!;
    expect(finding.provenanceLabel).toBeTruthy();
    render(<FindingCard finding={finding} />);

    expect(screen.getByText(finding.provenanceLabel as string)).toBeTruthy();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the critical finding's row tone as critical", () => {
    const finding = findingsById().get("F-04")!;
    expect(finding.severity).toBe("critical");
    const { container } = render(<FindingCard finding={finding} />);

    expect(container.querySelector('[data-row-tone="critical"]')).not.toBeNull();
  });

  it("toggle click expands aria-expanded and reveals a source excerpt (R8: sync enter)", () => {
    const finding = findingsById().get("F-03")!;
    render(<FindingCard finding={finding} />);

    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(finding.sources[0].excerpt)).toBeTruthy();
  });

  it('shows the "HOWEVER" block only for the finding that has `however`', () => {
    const withHowever = findingsById().get("F-03")!;
    expect(withHowever.however).toBeTruthy();
    const without = findingsById().get("F-01")!;
    expect(without.however).toBeNull();

    const withHoweverRender = render(<FindingCard finding={withHowever} />);
    fireEvent.click(withHoweverRender.getByRole("button"));
    expect(withHoweverRender.getByText("HOWEVER")).toBeTruthy();
    expect(withHoweverRender.getByText(withHowever.however as string)).toBeTruthy();
    withHoweverRender.unmount();

    const { queryByText, getByRole } = render(<FindingCard finding={without} />);
    fireEvent.click(getByRole("button"));
    expect(queryByText("HOWEVER")).not.toBeInTheDocument();
  });

  it("never renders a live anchor even when a source name is a domain, and shows it defanged", () => {
    const finding = findingsById().get("F-05")!;
    const domainSource = finding.sources.find((s) => s.defang);
    expect(domainSource).toBeTruthy();

    const { container } = render(<FindingCard finding={finding} />);
    fireEvent.click(screen.getByRole("button"));

    expect(container.querySelector("a[href]")).toBeNull();
    expect(container.textContent).toContain("[.]");
  });

  it("gives the unverifiable finding's claim a body weight of 500 (product rule #6)", () => {
    const finding = findingsById().get("F-06")!;
    expect(finding.direction).toBe("unverifiable");

    render(<FindingCard finding={finding} />);
    const claim = screen.getByText(finding.claim);
    const weight = claim.getAttribute("data-weight") ?? claim.style.fontWeight;
    expect(String(weight)).toBe("500");
  });

  it("gives a non-unverifiable finding's claim a bold weight of 700", () => {
    const finding = findingsById().get("F-04")!;
    render(<FindingCard finding={finding} />);
    const claim = screen.getByText(finding.claim);
    const weight = claim.getAttribute("data-weight") ?? claim.style.fontWeight;
    expect(String(weight)).toBe("700");
  });

  it("marks the unverifiable finding's row tone as neutral, not a warning color", () => {
    const finding = findingsById().get("F-06")!;
    const { container } = render(<FindingCard finding={finding} />);
    expect(container.querySelector('[data-row-tone="neutral"]')).not.toBeNull();
    expect(container.textContent).not.toContain("WARNING");
  });

  it("gives the unverifiable finding's marker dot the muted/grey color, never the suspicious color, even though it has severity medium (product rule #6)", () => {
    const finding = findingsById().get("F-06")!;
    expect(finding.direction).toBe("unverifiable");
    expect(finding.severity).toBe("medium");

    const { container } = render(<FindingCard finding={finding} />);
    const marker = container.querySelector('[data-severity="unverified"]');
    expect(marker).not.toBeNull();
    expect((marker as HTMLElement).style.background).toBe("var(--color-muted)");
    expect(container.querySelector('[data-severity="medium"]')).toBeNull();
  });
});
