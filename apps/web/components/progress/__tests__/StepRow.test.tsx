import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepRow } from "../StepRow";

// Mirror the component's own formatter so the assertion is timezone-agnostic:
// we assert the row shows *this* moment formatted, not a hard-coded string that
// would only match in one timezone.
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

describe("StepRow — col1 timestamp", () => {
  it("shows the step's own finished_at time for a done row", () => {
    const finishedAt = "2026-08-20T08:15:00.000Z";
    render(<StepRow step={{ title: "Reading the posting" }} state="done" finishedAt={finishedAt} />);

    expect(screen.getByText(clock(finishedAt))).toBeInTheDocument();
  });

  it("shows each row its own finish time — not one shared time", () => {
    const first = "2026-08-20T08:15:00.000Z";
    const second = "2026-08-20T08:47:00.000Z";
    const { rerender } = render(
      <StepRow step={{ title: "A" }} state="done" finishedAt={first} />,
    );
    expect(screen.getByText(clock(first))).toBeInTheDocument();

    rerender(<StepRow step={{ title: "B" }} state="done" finishedAt={second} />);
    expect(screen.getByText(clock(second))).toBeInTheDocument();
    expect(clock(first)).not.toEqual(clock(second));
  });

  it("shows an em dash for a terminal row missing its finished_at", () => {
    render(<StepRow step={{ title: "A" }} state="done" finishedAt={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("labels running and queued rows by state, not a time", () => {
    const { rerender } = render(<StepRow step={{ title: "A" }} state="running" />);
    expect(screen.getByText("running")).toBeInTheDocument();

    rerender(<StepRow step={{ title: "A" }} state="queued" />);
    expect(screen.getByText("queued")).toBeInTheDocument();
  });
});
