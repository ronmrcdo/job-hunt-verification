import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const insert = vi.fn().mockResolvedValue({ error: null });
const from = vi.fn(() => ({ insert }));
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ from }),
}));

import { VerdictWidget } from "../VerdictWidget";

const FINDINGS = [
  { id: "f_company_01", claim: "Company domain registered two weeks ago." },
  { id: "f_recruiter_02", claim: "Recruiter email is a free Gmail address." },
];

describe("VerdictWidget", () => {
  beforeEach(() => {
    insert.mockClear();
    from.mockClear();
  });

  it("offers the three verdicts once opened", async () => {
    render(<VerdictWidget investigationId="inv-1" findings={FINDINGS} reported={false} onReported={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /report an issue with this assessment/i }));
    expect(screen.getByRole("radio", { name: /this looks right/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /rated too high/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /rated too low/i })).toBeInTheDocument();
  });

  it("reveals the finding-picker only for too-high / too-low", async () => {
    render(<VerdictWidget investigationId="inv-1" findings={FINDINGS} reported={false} onReported={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /report an issue with this assessment/i }));

    await userEvent.click(screen.getByRole("radio", { name: /this looks right/i }));
    expect(screen.queryByLabelText(/which finding/i)).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: /rated too high/i }));
    expect(screen.getByLabelText(/which finding/i)).toBeInTheDocument();
  });

  it("bounds the note at 2000 characters", async () => {
    render(<VerdictWidget investigationId="inv-1" findings={FINDINGS} reported={false} onReported={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /report an issue with this assessment/i }));
    await userEvent.click(screen.getByRole("radio", { name: /rated too high/i }));
    expect(screen.getByRole("textbox", { name: /note/i })).toHaveAttribute("maxLength", "2000");
  });

  it("submits exactly one INSERT with the right shape and acknowledges", async () => {
    const onReported = vi.fn();
    render(<VerdictWidget investigationId="inv-1" findings={FINDINGS} reported={false} onReported={onReported} />);
    await userEvent.click(screen.getByRole("button", { name: /report an issue with this assessment/i }));
    await userEvent.click(screen.getByRole("radio", { name: /rated too high/i }));
    await userEvent.selectOptions(screen.getByLabelText(/which finding/i), "f_recruiter_02");
    await userEvent.type(screen.getByRole("textbox", { name: /note/i }), "gmail is normal for this agency");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(onReported).toHaveBeenCalledTimes(1));
    expect(from).toHaveBeenCalledWith("feedback");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      investigation_id: "inv-1",
      verdict: "too_high",
      wrong_finding_id: "f_recruiter_02",
      note: "gmail is normal for this agency",
    });
  });

  it("shows only the acknowledgement when already reported", () => {
    render(<VerdictWidget investigationId="inv-1" findings={FINDINGS} reported={true} onReported={vi.fn()} />);
    expect(screen.getByText(/thanks — we'll look at it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /report an issue/i })).toBeNull();
  });
});
