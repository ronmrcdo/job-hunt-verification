import { Suspense } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LandingPage from "../page";
import SignInPage from "../sign-in/page";
import DetailsPage from "../check/new/page";
import RunningPage from "../check/running/page";
import ReportPage from "../report/[id]/page";
import { FlowProvider } from "../../lib/flow-context";
import { SAMPLE_HIGH } from "../../lib/__fixtures__/sample-high";

// End-to-end transition test for the README "State model":
// start (signed-out) -> auth gate holding the pasted input -> details ->
// progress -> report; then "Check another posting" resets flow and returns
// to `/`.
//
// Real Next routing doesn't run in jsdom, so navigation is simulated: a
// shared `push` mock stands in for next/navigation's router, and each hop
// unmounts the current screen and renders the next one inside its own
// `<FlowProvider>` — exactly as the app does per-route. Each screen's
// FlowProvider re-hydrates its (sessionStorage-backed) survivable flow
// state on mount, so state set on one screen is visible to the next, the
// same way it would be across a real route change.

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  // AuthForm's "Back to the posting" link uses next/link, which is fine
  // unmocked in jsdom, but AuthForm also imports it directly — no mock
  // needed here beyond useRouter.
}));

const createInvestigation = vi.fn();
const fetchInvestigation = vi.fn();

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    createInvestigation: (...args: unknown[]) => createInvestigation(...args),
    fetchInvestigation: (...args: unknown[]) => fetchInvestigation(...args),
  };
});

vi.mock("../../lib/ownerKey", () => ({
  getOwnerKey: () => "test-owner-key",
}));

const STORAGE_KEY = "jhv_flow";

const PASTED_POSTING = "Virtual Assistant, $2,500/month, immediate start, no experience required";

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
  createInvestigation.mockReset();
  fetchInvestigation.mockReset();
});

describe("end-to-end flow: paste -> sign-in -> details -> progress -> report -> reset", () => {
  it("carries flow state through every hop and resets on 'CHECK ANOTHER POSTING'", async () => {
    // --- 1. LANDING (signed-out): paste, START, expect /sign-in ---
    const landing = render(
      <FlowProvider>
        <LandingPage />
      </FlowProvider>,
    );

    const scanField = screen.getByRole("textbox", { name: "JOB LINK OR JOB TEXT" });
    fireEvent.change(scanField, { target: { value: PASTED_POSTING } });
    fireEvent.click(screen.getByRole("button", { name: "START INVESTIGATION" }));

    expect(push).toHaveBeenCalledWith("/sign-in");
    landing.unmount();

    // --- 2. SIGN-IN: QueuedCard shows the paste; sign in; expect /check/new ---
    const signIn = render(
      <FlowProvider>
        <SignInPage />
      </FlowProvider>,
    );

    expect(await screen.findByText(PASTED_POSTING)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "SIGN IN AND RUN THE CHECK" }));

    expect(push).toHaveBeenCalledWith("/check/new");

    const persistedAfterSignIn = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persistedAfterSignIn.signedIn).toBe(true);
    expect(persistedAfterSignIn.authEmail).toBe("jane@example.com");
    signIn.unmount();

    // --- 3. DETAILS: job field prefilled; SKIP; expect /check/running ---
    const details = render(
      <FlowProvider>
        <DetailsPage />
      </FlowProvider>,
    );

    const jobField = (await screen.findByRole("textbox", {
      name: "Job link or job text",
    })) as HTMLTextAreaElement;
    expect(jobField.value).toBe(PASTED_POSTING);

    fireEvent.click(screen.getByRole("button", { name: "SKIP THE EXTRAS AND RUN IT" }));

    expect(push).toHaveBeenCalledWith("/check/running");
    details.unmount();

    // --- 4. PROGRESS: stub the POST + owner key, run the script, expect /report/:id ---
    createInvestigation.mockResolvedValue({ id: "abc" });
    vi.useFakeTimers();

    const running = render(
      <FlowProvider>
        <RunningPage />
      </FlowProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(push).toHaveBeenCalledWith("/report/abc");

    vi.useRealTimers();
    running.unmount();

    // --- 5. REPORT: stub fetch -> SAMPLE_HIGH; assert HIGH RISK; then reset ---
    fetchInvestigation.mockResolvedValue(SAMPLE_HIGH.inv);

    let report!: ReturnType<typeof render>;
    await act(async () => {
      report = render(
        <FlowProvider>
          <Suspense fallback={null}>
            <ReportPage params={Promise.resolve({ id: "abc" })} />
          </Suspense>
        </FlowProvider>,
      );
    });

    expect(await screen.findByText("HIGH RISK")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "CHECK ANOTHER POSTING" }));

    expect(push).toHaveBeenCalledWith("/");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    report.unmount();
  });
});
