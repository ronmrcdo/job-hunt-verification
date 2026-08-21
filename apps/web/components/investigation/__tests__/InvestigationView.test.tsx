import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const live = vi.fn();
vi.mock("../../../lib/investigations-live", async (orig) => ({
  ...(await orig<any>()),
  useInvestigationLive: (_id: string, initial: any) => live(initial),
}));
import { InvestigationView } from "../InvestigationView";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";
import { FlowProvider } from "../../../lib/flow-context";

function setLive(investigation: any, steps: any[]) {
  live.mockReturnValue({ investigation, steps });
}

function renderView(initial: { investigation: any; steps: any[] }) {
  return render(
    <FlowProvider>
      <InvestigationView initial={initial} />
    </FlowProvider>,
  );
}

describe("InvestigationView", () => {
  it("renders the checklist while running", () => {
    setLive({ ...SAMPLE_HIGH.inv, status: "running" }, [
      {
        investigation_id: "i",
        step_key: "intake",
        label: "Reading the posting",
        display_order: 1,
        status: "done",
        started_at: null,
        finished_at: null,
      },
      {
        investigation_id: "i",
        step_key: "report",
        label: "Writing the report",
        display_order: 6,
        status: "running",
        started_at: null,
        finished_at: null,
      },
    ]);
    renderView({ investigation: { ...SAMPLE_HIGH.inv, status: "running" }, steps: [] });
    expect(screen.getByText(/reading the posting/i)).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_HIGH.inv.assessment!.summary)).not.toBeInTheDocument();
  });

  it("renders the report when done", () => {
    setLive({ ...SAMPLE_HIGH.inv, status: "done" }, []);
    renderView({ investigation: { ...SAMPLE_HIGH.inv, status: "done" }, steps: [] });
    expect(screen.getByText(SAMPLE_HIGH.inv.assessment!.summary)).toBeInTheDocument();
  });

  it("renders an error panel when failed", () => {
    setLive({ ...SAMPLE_HIGH.inv, status: "failed" }, []);
    renderView({ investigation: { ...SAMPLE_HIGH.inv, status: "failed" }, steps: [] });
    expect(
      screen.getAllByText(/couldn.t finish|something went wrong|run it again|try again/i).length,
    ).toBeGreaterThan(0);
  });

  it("shows a couldn't-complete panel, never a MODERATE band, when assessment is null", () => {
    const investigation = { ...SAMPLE_HIGH.inv, status: "deadline_exceeded", assessment: null };
    setLive(investigation, []);
    renderView({ investigation, steps: [] });
    expect(screen.getByText(/couldn.t complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/MODERATE/i)).not.toBeInTheDocument();
  });

  it("names the company from entities.company_name over the worker title when both are present", () => {
    // title and entities.company_name deliberately diverge here so this test can
    // only pass if entities.company_name is read first, not merely that *some*
    // fallback fired.
    const investigation = {
      ...SAMPLE_HIGH.inv,
      status: "running",
      submission: { job_text: "x" },
      title: "Some Other Title",
      entities: { ...SAMPLE_HIGH.inv.entities, company_name: "Acme Global" },
    };
    setLive(investigation, []);
    renderView({ investigation, steps: [] });
    expect(screen.getByText(/Acme Global · the posting/)).toBeInTheDocument();
    expect(screen.queryByText(/Some Other Title · the posting/)).not.toBeInTheDocument();
  });

  it("falls back to the worker title when entities has no company name", () => {
    const investigation = {
      ...SAMPLE_HIGH.inv,
      status: "running",
      submission: { job_text: "x" },
      title: "Some Other Title",
      entities: null,
    };
    setLive(investigation, []);
    renderView({ investigation, steps: [] });
    expect(screen.getByText(/Some Other Title · the posting/)).toBeInTheDocument();
  });

  it("falls back to 'The company' when nothing named it", () => {
    const investigation = {
      ...SAMPLE_HIGH.inv,
      status: "running",
      submission: { job_text: "x" },
      title: null,
      entities: null,
    };
    setLive(investigation, []);
    renderView({ investigation, steps: [] });
    expect(screen.getByText(/The company · the posting/)).toBeInTheDocument();
  });
});
