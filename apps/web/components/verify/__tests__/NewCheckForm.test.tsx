import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createInvestigation = vi.fn();
const quotaStatus = vi.fn();
vi.mock("../../../lib/investigations", async (importActual) => ({
  // `quotaView` is a pure derivation — keep the real one so the submit gate
  // and QuotaMeter stay under test; only the async data/side-effect fns are mocked.
  ...(await importActual<typeof import("../../../lib/investigations")>()),
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
  quotaStatus.mockResolvedValue({ weeklyUsed: 0, weeklyLimit: 3, resetsAt: null, topUpBalance: 0 });
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
    quotaStatus.mockResolvedValueOnce({ weeklyUsed: 1, weeklyLimit: 3, resetsAt: "2026-09-04T00:00:00Z", topUpBalance: 0 });
    createInvestigation.mockResolvedValue({ id: "abc" });
    render(<NewCheckForm initialJobText="x" />);
    expect(await screen.findByText(/2 of 3 weekly checks left/i)).toBeInTheDocument();
  });

  it("disables submit and blocks the call when both buckets are exhausted", async () => {
    quotaStatus.mockResolvedValueOnce({ weeklyUsed: 3, weeklyLimit: 3, resetsAt: "2026-09-04T00:00:00Z", topUpBalance: 0 });
    render(<NewCheckForm initialJobText="Acme VA role" />);
    await screen.findByText(/0 of 3 weekly checks left/i);
    const button = screen.getByRole("button", { name: /run the check/i });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(createInvestigation).not.toHaveBeenCalled();
  });

  it("maps a quota rejection on submit to the reset message", async () => {
    quotaStatus.mockResolvedValueOnce({ weeklyUsed: 2, weeklyLimit: 3, resetsAt: null, topUpBalance: 0 });
    createInvestigation.mockResolvedValueOnce({
      error: "check_quota_exceeded", quotaExceeded: true, resetsAt: "2026-09-04T00:00:00Z",
    });
    render(<NewCheckForm initialJobText="Acme VA role" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(await screen.findByText(/used all 3 weekly checks/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows weekly remaining and bonus count, submit enabled when bonus remains", async () => {
    quotaStatus.mockResolvedValueOnce({ weeklyUsed: 3, weeklyLimit: 3, resetsAt: "2026-08-28T00:00:00Z", topUpBalance: 4 });
    render(<NewCheckForm initialJobText="x" />);
    await screen.findByText(/0 of 3 weekly checks left/i);
    expect(screen.getByText(/\+4 bonus checks/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run the check/i })).toBeEnabled();
  });

  it("disables submit only when weekly is exhausted AND balance is 0", async () => {
    quotaStatus.mockResolvedValueOnce({ weeklyUsed: 3, weeklyLimit: 3, resetsAt: "2026-08-28T00:00:00Z", topUpBalance: 0 });
    render(<NewCheckForm initialJobText="x" />);
    expect(await screen.findByRole("button", { name: /run the check/i })).toBeDisabled();
  });
});
