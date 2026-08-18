import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingCard } from "../../components/report/FindingCard";
import { BandBanner } from "../../components/report/BandBanner";
import { Button } from "../../components/ui/Button";
import { toReportViewModel } from "../../lib/report-view-model";
import { SAMPLE_HIGH } from "../../lib/__fixtures__/sample-high";

// Task 6.1: mobile (<=430px) structural affordances. jsdom has no real
// layout engine, so these assert the stable data-hooks the max-[430px]:
// CSS targets — the visual truth is verified manually against the 390px
// frames (README §6 / canvas 4a).

describe("mobile affordances", () => {
  it("FindingCard exposes a data-mobile-hide-recordid hook on the record-id cell", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const finding = vm.groups.flatMap((g) => g.findings)[0];
    const { container } = render(<FindingCard finding={finding} />);

    expect(container.querySelector("[data-mobile-hide-recordid]")).not.toBeNull();
  });

  it("Button primary exposes a data-fullwidth-mobile affordance", () => {
    render(<Button variant="primary">GO</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-fullwidth-mobile");
  });

  it("BandBanner marks the confidence node with data-mobile-order=above", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv, SAMPLE_HIGH.submitted);
    const { container } = render(
      <BandBanner vm={vm} confidenceSlot={<div data-testid="confidence-slot">slot</div>} />
    );

    const marked = container.querySelector('[data-mobile-order="above"]');
    expect(marked).not.toBeNull();
    expect(marked?.querySelector('[data-testid="confidence-slot"]')).not.toBeNull();
  });
});
