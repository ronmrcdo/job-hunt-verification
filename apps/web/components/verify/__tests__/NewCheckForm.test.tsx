import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createInvestigation = vi.fn();
vi.mock("../../../lib/investigations", () => ({ createInvestigation: (...a: any) => createInvestigation(...a) }));
vi.mock("../../../lib/supabase/client", () => ({ createClient: () => ({}) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewCheckForm } from "../NewCheckForm";
import { FlowProvider, useFlow } from "../../../lib/flow-context";

beforeEach(() => {
  vi.clearAllMocks();
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
});
