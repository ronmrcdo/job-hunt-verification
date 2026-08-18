import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingGroup } from "../FindingGroup";
import type { components } from "@job-hunt/api-types";

type Finding = components["schemas"]["Finding"];
type Source = components["schemas"]["Source"];

// Malicious/attacker-influenced content (spec §9.2): a fetched job posting
// or source could contain markup or a raw suspicious URL. Neither must ever
// become live HTML or a clickable link (spec §9.5).
const MALICIOUS_CLAIM = '<img src=x onerror="alert(1)"> Recruiter asks for a fee';
const SUSPICIOUS_URL = "https://acme-globall.com/pay";

const findings: Finding[] = [
  {
    id: "f1",
    direction: "suspicious",
    claim: MALICIOUS_CLAIM,
    source_ids: ["s1"],
    mitigation: null,
  } as Finding,
];

const sources: Source[] = [
  {
    id: "s1",
    url: SUSPICIOUS_URL,
    kind: "fetched_page",
    retrieved_at: "2026-01-01T00:00:00Z",
    content_summary: "asks for a $500 deposit",
  } as Source,
];

describe("FindingGroup", () => {
  it("renders findings and their sources under the group heading", () => {
    render(<FindingGroup direction="suspicious" findings={findings} sources={sources} />);
    expect(screen.getByText("Worth a closer look")).toBeTruthy();
    expect(screen.getByText(/asks for a \$500 deposit/)).toBeTruthy();
  });

  it("never renders fetched content as live HTML (escapes markup instead of injecting it)", () => {
    const { container } = render(
      <FindingGroup direction="suspicious" findings={findings} sources={sources} />
    );
    // The <img onerror=...> string must appear as literal escaped text, not
    // as an actual <img> element in the DOM.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(MALICIOUS_CLAIM);
  });

  it("defangs suspicious URLs and never renders a live <a href> to them", () => {
    const { container } = render(
      <FindingGroup direction="suspicious" findings={findings} sources={sources} />
    );
    expect(container.textContent).toContain("hxxps://acme-globall[.]com/pay");
    expect(container.querySelector(`a[href="${SUSPICIOUS_URL}"]`)).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
