import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import Page from "../running/page";
import { FlowProvider, useFlow } from "../../../lib/flow-context";
import { FetchError } from "../../../lib/api";

const push = vi.fn();
const createInvestigation = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    createInvestigation: (...args: unknown[]) => createInvestigation(...args),
  };
});

vi.mock("../../../lib/ownerKey", () => ({
  getOwnerKey: () => "test-owner-key",
}));

const STORAGE_KEY = "jhv_flow";

// Probe that surfaces the flow's fetchError flag as text, so the failure
// test can assert on it without reaching into context internals.
function FetchErrorProbe() {
  const { state } = useFlow();
  return <div data-testid="fetch-error-probe">{String(state.fetchError)}</div>;
}

function renderPage() {
  return render(
    <FlowProvider>
      <FetchErrorProbe />
      <Page />
    </FlowProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      jobInput: "Virtual Assistant, $2,500/month",
      company: "Acme Global",
      email: "recruiter@example.com",
    }),
  );
  push.mockClear();
  createInvestigation.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("/check/running page", () => {
  it("navigates to the report once both the POST resolves and the script finishes", async () => {
    createInvestigation.mockResolvedValue({ id: "abc" });

    renderPage();

    expect(createInvestigation).toHaveBeenCalledTimes(1);
    expect(createInvestigation).toHaveBeenCalledWith(
      {
        jobText: "Virtual Assistant, $2,500/month",
        companyName: "Acme Global",
        recruiterEmail: "recruiter@example.com",
        jobUrl: undefined,
      },
      "test-owner-key",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(push).toHaveBeenCalledWith("/report/abc");
  });

  it("routes home and sets flow fetchError on POST failure", async () => {
    createInvestigation.mockRejectedValue(new FetchError("failed to create investigation (500)", 500));

    const { getByTestId } = renderPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(getByTestId("fetch-error-probe").textContent).toBe("true");
    expect(push).toHaveBeenCalledWith("/");
  });
});
