import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailsForm } from "../DetailsForm";
import { FlowProvider, useFlow } from "../../../lib/flow-context";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const STORAGE_KEY = "jhv_flow";

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
});

// Probe that exposes the current flow state as text, so tests can assert on
// state written by DetailsForm without reaching into the provider directly.
function CompanyProbe() {
  const { state } = useFlow();
  return <div data-testid="company-probe">{state.company}</div>;
}

describe("DetailsForm", () => {
  it("prefills the job field from flow jobInput", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ jobInput: "Assistant role, remote, flexible hours" }),
    );

    render(
      <FlowProvider>
        <DetailsForm />
      </FlowProvider>,
    );

    expect(await screen.findByDisplayValue("Assistant role, remote, flexible hours")).toBeTruthy();
  });

  it("editing the Company field updates flow state", async () => {
    render(
      <FlowProvider>
        <DetailsForm />
        <CompanyProbe />
      </FlowProvider>,
    );

    const companyField = await screen.findByLabelText(/company name/i);
    fireEvent.change(companyField, { target: { value: "Acme Global" } });

    expect(screen.getByTestId("company-probe").textContent).toBe("Acme Global");
  });

  it('clicking "SKIP THE EXTRAS AND RUN IT" routes to /check/running without requiring optional fields', async () => {
    render(
      <FlowProvider>
        <DetailsForm />
      </FlowProvider>,
    );

    const skipButton = await screen.findByRole("button", { name: "SKIP THE EXTRAS AND RUN IT" });
    fireEvent.click(skipButton);

    expect(push).toHaveBeenCalledWith("/check/running");
  });

  it("shows the conversation helper text", async () => {
    render(
      <FlowProvider>
        <DetailsForm />
      </FlowProvider>,
    );

    expect(
      await screen.findByText("Text only — copy and paste the messages. Screenshots aren't supported yet."),
    ).toBeTruthy();
  });
});
