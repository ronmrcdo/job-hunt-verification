import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createInvestigation = vi.fn();
const quotaStatus = vi.fn();
vi.mock("../../../lib/investigations", () => ({
  createInvestigation: (...a: any) => createInvestigation(...a),
  quotaStatus: (...a: any) => quotaStatus(...a),
}));
vi.mock("../../../lib/supabase/client", () => ({ createClient: () => ({}) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewCheckForm } from "../NewCheckForm";
import { FlowProvider, useFlow } from "../../../lib/flow-context";

beforeEach(() => {
  vi.clearAllMocks();
  quotaStatus.mockResolvedValue({ used: 0, limit: 3, resetsAt: null });
  window.sessionStorage.clear();
});

function DraftProbe({ onState }: { onState: (jobInput: string) => void }) {
  const flow = useFlow();
  onState(flow.state.jobInput);
  return null;
}

describe("NewCheckForm", () => {
  it("blocks submit with an empty posting", async () => {
    render(<NewCheckForm initialJobText="" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(createInvestigation).not.toHaveBeenCalled();
    expect(screen.getByText(/paste the posting/i)).toBeInTheDocument();
  });

  it("inserts and navigates to the investigation on success", async () => {
    createInvestigation.mockResolvedValueOnce({ id: "abc" });
    render(<NewCheckForm initialJobText="Acme VA role, pay upfront" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(createInvestigation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ job_text: "Acme VA role, pay upfront" }),
    );
    expect(push).toHaveBeenCalledWith("/investigations/abc");
  });

  it("shows a spinner and locks the button while the check is in flight", async () => {
    let release!: (r: { id: string }) => void;
    createInvestigation.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<NewCheckForm initialJobText="Acme VA role, pay upfront" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));

    const button = screen.getByRole("button", { name: /running the check/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(createInvestigation).toHaveBeenCalledTimes(1);

    release({ id: "abc" });
    await screen.findByRole("button", { name: /running the check/i });
    expect(push).toHaveBeenCalledWith("/investigations/abc");
  });

  it("shows an insert error on the form", async () => {
    createInvestigation.mockResolvedValueOnce({ error: "violates check constraint" });
    render(<NewCheckForm initialJobText="x" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(await screen.findByText(/couldn.t start|check constraint/i)).toBeInTheDocument();
  });

  it("clears the carried flow draft after a successful submit", async () => {
    createInvestigation.mockResolvedValueOnce({ id: "abc" });
    let latestJobInput = "";
    render(
      <FlowProvider>
        <DraftProbe onState={(v) => (latestJobInput = v)} />
        <NewCheckForm initialJobText="Acme VA role, pay upfront" />
      </FlowProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(push).toHaveBeenCalledWith("/investigations/abc");
    expect(latestJobInput).toBe("");
    expect(window.sessionStorage.getItem("jhv_flow")).toBeNull();
  });

  it("does not clear the flow draft when the submit fails", async () => {
    window.sessionStorage.setItem(
      "jhv_flow",
      JSON.stringify({ jobInput: "x", company: "", site: "", recruiter: "", email: "", convo: "" }),
    );
    createInvestigation.mockResolvedValueOnce({ error: "violates check constraint" });
    let latestJobInput = "";
    render(
      <FlowProvider>
        <DraftProbe onState={(v) => (latestJobInput = v)} />
        <NewCheckForm initialJobText="x" />
      </FlowProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(await screen.findByText(/couldn.t start|check constraint/i)).toBeInTheDocument();
    expect(latestJobInput).toBe("x");
    expect(window.sessionStorage.getItem("jhv_flow")).not.toBeNull();
  });

  it("shows remaining checks and the reset date", async () => {
    quotaStatus.mockResolvedValueOnce({ used: 1, limit: 3, resetsAt: "2026-09-04T00:00:00Z" });
    createInvestigation.mockResolvedValue({ id: "abc" });
    render(<NewCheckForm initialJobText="x" />);
    expect(await screen.findByText(/2 of 3 checks left/i)).toBeInTheDocument();
  });

  it("disables submit and blocks the call when the quota is exhausted", async () => {
    quotaStatus.mockResolvedValueOnce({ used: 3, limit: 3, resetsAt: "2026-09-04T00:00:00Z" });
    render(<NewCheckForm initialJobText="Acme VA role" />);
    await screen.findByText(/0 of 3 checks left/i);
    const button = screen.getByRole("button", { name: /run the check/i });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(createInvestigation).not.toHaveBeenCalled();
  });

  it("maps a quota rejection on submit to the reset message", async () => {
    quotaStatus.mockResolvedValueOnce({ used: 2, limit: 3, resetsAt: null });
    createInvestigation.mockResolvedValueOnce({
      error: "check_quota_exceeded", quotaExceeded: true, resetsAt: "2026-09-04T00:00:00Z",
    });
    render(<NewCheckForm initialJobText="Acme VA role" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(await screen.findByText(/used all 3 checks/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
