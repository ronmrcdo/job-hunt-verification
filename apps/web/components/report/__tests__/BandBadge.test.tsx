import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BandBadge } from "../BandBadge";

describe("BandBadge", () => {
  it("shows the band and confidence, never a percentage", () => {
    render(<BandBadge band="MODERATE" confidence="LOW" />);
    expect(screen.getByText(/MODERATE/)).toBeTruthy();
    expect(screen.getByText(/confidence: low/i)).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
