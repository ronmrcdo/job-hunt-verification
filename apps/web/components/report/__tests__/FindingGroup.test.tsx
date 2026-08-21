import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingGroup } from "../FindingGroup";
import { Summary } from "../Summary";
import { CountsStrip } from "../CountsStrip";
import { toReportViewModel } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";

function highVM() {
  return toReportViewModel(SAMPLE_HIGH.inv);
}

describe("FindingGroup", () => {
  it("renders the group heading, mono zero-padded count, and one FindingCard per finding", () => {
    const vm = highVM();
    const suspicious = vm.groups.find((g) => g.key === "suspicious")!;
    render(<FindingGroup group={suspicious} />);

    expect(screen.getByText("What looks suspicious")).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
    expect(screen.getAllByText(/^F-0\d$/)).toHaveLength(3);
  });

  it("precedes the unverifiable group with the neutral open-questions preamble", () => {
    const vm = highVM();
    const unverifiable = vm.groups.find((g) => g.key === "unverifiable")!;
    render(<FindingGroup group={unverifiable} />);

    expect(
      screen.getByText("Open questions, not accusations. Each one is a gap in what we could reach."),
    ).toBeTruthy();
  });

  it("does not show the open-questions preamble for the suspicious group", () => {
    const vm = highVM();
    const suspicious = vm.groups.find((g) => g.key === "suspicious")!;
    render(<FindingGroup group={suspicious} />);

    expect(
      screen.queryByText("Open questions, not accusations. Each one is a gap in what we could reach."),
    ).toBeNull();
  });
});

describe("Summary", () => {
  it("renders the SUMMARY micro label and the passed summary text", () => {
    const vm = highVM();
    render(<Summary summary={vm.summary as string} />);

    expect(screen.getByText("SUMMARY")).toBeTruthy();
    expect(screen.getByText(vm.summary as string)).toBeTruthy();
  });
});

describe("CountsStrip", () => {
  it("shows zero-padded legit/suspicious/unverified counts, suspicious cell on warn-tint", () => {
    const vm = highVM();
    render(<CountsStrip vm={vm} />);

    const legit = screen.getByTestId("count-legit");
    const suspicious = screen.getByTestId("count-suspicious");
    const unverified = screen.getByTestId("count-unverified");

    expect(legit.textContent).toContain("02");
    expect(legit.textContent).toContain("checks out");
    expect(suspicious.textContent).toContain("03");
    expect(suspicious.textContent).toContain("suspicious");
    expect(unverified.textContent).toContain("02");
    expect(unverified.textContent).toContain("unverified");

    expect(suspicious.getAttribute("style")).toContain("var(--color-warn-tint)");
  });

  it("shows 00 for a group that has zero findings", () => {
    // legitimizing group present in vm.groups only when non-empty (see
    // report-view-model.ts); a vm with no legitimizing findings should
    // still render "00 checks out" rather than omitting the cell.
    const vm = highVM();
    const withoutLegit = { ...vm, groups: vm.groups.filter((g) => g.key !== "legitimizing") };
    render(<CountsStrip vm={withoutLegit} />);

    expect(screen.getByTestId("count-legit").textContent).toContain("00");
  });

  it("renders nothing when the report has one or zero findings total", () => {
    // A 00/01/00 strip is empty scaffolding: two zero cells plus one number
    // the findings list already states in full. The strip only earns its
    // space once there's a spread to summarize (>1 finding), so a single-
    // finding report omits it entirely.
    const vm = highVM();
    const first = vm.groups[0];
    const single = { ...vm, groups: [{ ...first, findings: [first.findings[0]] }] };
    const { container } = render(<CountsStrip vm={single} />);

    expect(screen.queryByTestId("count-suspicious")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
