import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { HowItRuns } from "../HowItRuns";
import { FourBands } from "../FourBands";

// The site header links to /#how-it-works and /#risk-bands — these sections
// must carry those ids or the navbar buttons scroll nowhere.
describe("landing section anchors", () => {
  it("HowItRuns carries the #how-it-works anchor the navbar targets", () => {
    const { container } = render(<HowItRuns />);
    expect(container.querySelector("#how-it-works")).toBeTruthy();
  });

  it("FourBands carries the #risk-bands anchor the navbar targets", () => {
    const { container } = render(<FourBands />);
    expect(container.querySelector("#risk-bands")).toBeTruthy();
  });
});
