import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BandBanner } from "../BandBanner";
import { toReportViewModel } from "../../../lib/report-view-model";
import type { CompleteReportVM } from "../../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";
import { SAMPLE_LOW } from "../../../lib/__fixtures__/sample-low";
import type { Investigation } from "../../../lib/investigations";

// Every fixture here (SAMPLE_HIGH/SAMPLE_LOW) carries a real assessment, so
// the report is always complete — this cast is honest for that reason.
function completeVM(inv: Investigation): CompleteReportVM {
  return toReportViewModel(inv) as CompleteReportVM;
}

describe("BandBanner", () => {
  it("renders the HIGH band with 3 of 4 segments filled in the band-high color", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    const { container } = render(<BandBanner vm={vm} />);

    expect(screen.getByText("HIGH RISK")).toBeTruthy();
    expect(screen.getByText(/BAND 3 OF 4/)).toBeTruthy();
    expect(screen.getByText(/CHECKED 3 TIMES/)).toBeTruthy();

    const segments = container.querySelectorAll("[data-filled]");
    expect(segments).toHaveLength(4);
    const filled = container.querySelectorAll('[data-filled="true"]');
    expect(filled).toHaveLength(3);
    filled.forEach((el) => {
      expect((el as HTMLElement).style.background).toBe("var(--color-band-high)");
      expect((el as HTMLElement).style.background).not.toBe("var(--color-band-critical)");
    });

    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("renders the LOW band with 1 of 4 segments filled in the band-low color", () => {
    const vm = completeVM(SAMPLE_LOW.inv);
    const { container } = render(<BandBanner vm={vm} />);

    expect(screen.getByText("LOW RISK")).toBeTruthy();
    expect(screen.getByText(/BAND 1 OF 4/)).toBeTruthy();
    expect(screen.getByText(/FIRST CHECK ON THIS POSTING/)).toBeTruthy();

    const filled = container.querySelectorAll('[data-filled="true"]');
    expect(filled).toHaveLength(1);
    filled.forEach((el) => {
      expect((el as HTMLElement).style.background).toBe("var(--color-band-low)");
    });

    expect(container.querySelector("a[href]")).toBeNull();
  });

  it("renders the confidenceSlot in the banner", () => {
    const vm = completeVM(SAMPLE_HIGH.inv);
    render(<BandBanner vm={vm} confidenceSlot={<div data-testid="confidence-slot">slot</div>} />);
    expect(screen.getByTestId("confidence-slot")).toBeTruthy();
  });
});
