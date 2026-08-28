import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));

import { EvalExport } from "../EvalExport";

const ID_A = "11111111-1111-1111-1111-111111111111";
const candidate = (id: string) => ({
  id,
  investigation_id: "inv1",
  submission_snapshot: { job_text: "x" },
  expected_max_band: "LOW" as const,
  expected_band: null,
  tags: [],
});

describe("EvalExport", () => {
  it("says how many candidates are waiting and offers the download", () => {
    render(<EvalExport result={{ ok: true, candidates: [candidate(ID_A), candidate("22222222-2222-2222-2222-222222222222")] }} />);
    expect(screen.getByText(/2 candidates awaiting export/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("href", "/admin/export");
  });

  it("uses the singular for one candidate", () => {
    render(<EvalExport result={{ ok: true, candidates: [candidate(ID_A)] }} />);
    expect(screen.getByText(/1 candidate awaiting export/i)).toBeInTheDocument();
  });

  it("offers a labelled field to paste the ids the merge script printed", () => {
    render(<EvalExport result={{ ok: true, candidates: [candidate(ID_A)] }} />);
    expect(screen.getByRole("textbox", { name: /candidate ids/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark exported/i })).toBeInTheDocument();
  });

  it("spells out the order of the steps so the flip is never done before the PR merges", () => {
    render(<EvalExport result={{ ok: true, candidates: [candidate(ID_A)] }} />);
    expect(screen.getByText(/after the pull request merges/i)).toBeInTheDocument();
  });

  it("shows nothing to export, and no form, when the queue is empty", () => {
    render(<EvalExport result={{ ok: true, candidates: [] }} />);
    expect(screen.getByText(/no candidates awaiting export/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark exported/i })).toBeNull();
  });

  it("distinguishes a read failure from an empty queue", () => {
    render(<EvalExport result={{ ok: false, error: "permission denied" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/permission denied/);
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
  });
});
