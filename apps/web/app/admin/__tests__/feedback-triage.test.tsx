import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// triage.tsx -> actions.ts -> lib/supabase/admin constructs a real client at
// module load from env that vitest does not set. Same stub as triage.test.ts.
vi.mock("../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));

import { FeedbackTriage, formatFeedbackStamp, postingLabel, verdictLabel } from "../triage";
import type { TriageRow } from "../triage";

function row(over: Partial<TriageRow["feedback"]> = {}, inv: TriageRow["investigation"] = null): TriageRow {
  return {
    feedback: {
      id: "fb1",
      investigation_id: "inv1",
      user_id: "u1",
      verdict: "agree",
      wrong_finding_id: null,
      note: null,
      created_at: "2026-08-27T14:17:41.945638+00:00",
      ...over,
    } as TriageRow["feedback"],
    investigation: inv,
  };
}

describe("triage formatting helpers", () => {
  it("renders the timestamp in the app's UTC-deterministic stamp format", () => {
    expect(formatFeedbackStamp("2026-08-27T14:17:41.945638+00:00")).toBe("27.08.2026 · 14:17");
  });

  it("turns raw verdict enums into human labels", () => {
    expect(verdictLabel("too_high")).toBe("Too high");
    expect(verdictLabel("too_low")).toBe("Too low");
    expect(verdictLabel("agree")).toBe("Agree");
  });

  it("labels a posting by company name, falling back to the job text, then to a placeholder", () => {
    expect(postingLabel({ company_name: "Acme", job_text: "hire" })).toBe("Acme");
    expect(postingLabel({ job_text: "Senior React dev wanted" })).toBe("Senior React dev wanted");
    expect(postingLabel({})).toBe("Untitled posting");
  });
});

describe("FeedbackTriage table", () => {
  it("renders one table row per feedback item with labelled columns", () => {
    render(
      <FeedbackTriage
        result={{
          ok: true,
          rows: [
            row({ id: "fb1", verdict: "agree", note: "But it has a lot of 30 suspicious" }, {
              id: "inv1",
              submission: { job_text: "Remote dev role", job_url: "https://ph.jobstreet.com/job/93712310" },
              assessment: null,
              findings: [],
            }),
            row({ id: "fb2", investigation_id: "inv2", verdict: "too_high", created_at: "2026-08-26T09:05:00Z" }),
          ],
        }}
      />,
    );
    const table = screen.getByRole("table", { name: /feedback/i });
    expect(within(table).getByRole("columnheader", { name: /verdict/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /received/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /posting/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /note/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /promote/i })).toBeInTheDocument();
    // header row + 2 data rows
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("Agree")).toBeInTheDocument();
    expect(screen.getByText("Too high")).toBeInTheDocument();
    expect(screen.getByText("But it has a lot of 30 suspicious")).toBeInTheDocument();
  });

  it("summarises the queue by verdict above the table", () => {
    render(
      <FeedbackTriage
        result={{
          ok: true,
          rows: [row({ id: "a", verdict: "agree" }), row({ id: "b", verdict: "too_high" }), row({ id: "c", verdict: "too_high" })],
        }}
      />,
    );
    expect(screen.getByText(/3 items/i)).toBeInTheDocument();
    expect(screen.getByText(/2 too high/i)).toBeInTheDocument();
  });

  it("shows the submitted URL defanged and never as a link", () => {
    render(
      <FeedbackTriage
        result={{
          ok: true,
          rows: [row({}, { id: "inv1", submission: { job_text: "x", job_url: "https://ph.jobstreet.com/job/93712310" }, assessment: null, findings: [] })],
        }}
      />,
    );
    expect(screen.getByText(/hxxps:\/\/ph\[\.\]jobstreet\[\.\]com/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names the flagged finding's claim when the feedback points at one", () => {
    render(
      <FeedbackTriage
        result={{
          ok: true,
          rows: [
            row({ verdict: "too_high", wrong_finding_id: "f_1" }, {
              id: "inv1",
              submission: { job_text: "x" },
              assessment: null,
              findings: [{ id: "f_1", claim: "Domain registered 3 days ago" }],
            }),
          ],
        }}
      />,
    );
    expect(screen.getByText(/Domain registered 3 days ago/)).toBeInTheDocument();
  });

  it("keeps the raw submission behind a disclosure instead of dumping it inline", () => {
    render(
      <FeedbackTriage
        result={{ ok: true, rows: [row({}, { id: "inv1", submission: { job_text: "x" }, assessment: null, findings: [] })] }}
      />,
    );
    const details = screen.getByText(/raw submission/i).closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("gives every promote control an accessible name scoped to its row", () => {
    render(<FeedbackTriage result={{ ok: true, rows: [row({ id: "fb1" }), row({ id: "fb2", investigation_id: "inv2" })] }} />);
    expect(screen.getAllByRole("combobox", { name: /expected max band/i })).toHaveLength(2);
    expect(screen.getAllByRole("textbox", { name: /tags/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /promote/i })).toHaveLength(2);
  });

  it("still distinguishes a read failure from an empty queue", () => {
    const { unmount } = render(<FeedbackTriage result={{ ok: false, error: "boom" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    expect(screen.queryByRole("table")).toBeNull();
    unmount();
    render(<FeedbackTriage result={{ ok: true, rows: [] }} />);
    expect(screen.getByText(/no feedback yet/i)).toBeInTheDocument();
  });
});

describe("FeedbackTriage assessment column", () => {
  const assessed = (band: string, confidence: string): TriageRow["investigation"] => ({
    id: "inv1",
    submission: { job_text: "x" },
    assessment: { band, confidence },
    findings: [],
  });

  it("shows the band the system returned and the confidence as a separate value", () => {
    render(<FeedbackTriage result={{ ok: true, rows: [row({}, assessed("HIGH", "MODERATE"))] }} />);
    const table = screen.getByRole("table", { name: /feedback/i });
    expect(within(table).getByRole("columnheader", { name: /assessed/i })).toBeInTheDocument();
    // "HIGH" is also an <option> in the promote form, so scope to the cell.
    const assessedCell = within(table).getAllByRole("cell")[1];
    expect(assessedCell).toHaveTextContent("HIGH");
    // Product rule #2: confidence is labelled as its own concept, never merged
    // into the band and never rendered as a score.
    expect(screen.getByText(/confidence\s+MODERATE/i)).toBeInTheDocument();
  });

  it("says so plainly when the investigation carries no assessment", () => {
    render(<FeedbackTriage result={{ ok: true, rows: [row({}, { id: "inv1", submission: {}, assessment: null, findings: [] })] }} />);
    expect(screen.getByText(/not assessed/i)).toBeInTheDocument();
  });

  it("preselects expected max band to the band that was returned, so agree is one click", () => {
    render(<FeedbackTriage result={{ ok: true, rows: [row({ verdict: "agree" }, assessed("MODERATE", "HIGH"))] }} />);
    expect(screen.getByRole("combobox", { name: /expected max band/i })).toHaveValue("MODERATE");
  });

  it("falls back to LOW when there is no band to preselect", () => {
    render(<FeedbackTriage result={{ ok: true, rows: [row()] }} />);
    expect(screen.getByRole("combobox", { name: /expected max band/i })).toHaveValue("LOW");
  });
});
