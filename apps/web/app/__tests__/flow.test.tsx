import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LandingPage from "../page";
import SignInPage from "../sign-in/page";
import { FlowProvider } from "../../lib/flow-context";

// Draft-carry test for the README "State model": the landing page no longer
// knows about auth state (that moved to real Supabase sessions, see the
// SiteHeader/AuthForm/middleware in Task 6) — it just writes the pasted
// posting into flow state and routes to `/sign-in`, which reads it back out
// on the other side. The rest of the authenticated flow (sign-in ->
// `/verify` -> `/investigations/:id`) is covered by its own suites:
// components/auth/__tests__ (Task 6), components/verify/__tests__ +
// lib/__tests__/flow-context.test.tsx (this task), and Task 8's
// InvestigationView suite — not re-tested here.
//
// Real Next routing doesn't run in jsdom, so navigation is simulated: a
// shared `push` mock stands in for next/navigation's router, and the hop
// unmounts the landing screen and renders sign-in inside its own
// `<FlowProvider>` — exactly as the app does per-route. Each screen's
// FlowProvider re-hydrates its (sessionStorage-backed) survivable flow
// state on mount, so state set on one screen is visible to the next, the
// same way it would be across a real route change.

const push = vi.fn();

// SignInPage is now an async server component that guards on session state
// (task 3.1) — mock an anonymous visitor so it renders the form here.
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  redirect: vi.fn(),
}));
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}));

const STORAGE_KEY = "jhv_flow";

const PASTED_POSTING = "Virtual Assistant, $2,500/month, immediate start, no experience required";

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("draft-carry flow: paste -> sign-in", () => {
  it("carries the pasted posting from the landing page into flow state and routes to /sign-in", async () => {
    // --- 1. LANDING: paste, START, expect /sign-in ---
    const landing = render(
      <FlowProvider>
        <LandingPage />
      </FlowProvider>,
    );

    const scanField = screen.getByRole("textbox", { name: "JOB LINK OR JOB TEXT" });
    fireEvent.change(scanField, { target: { value: PASTED_POSTING } });
    fireEvent.click(screen.getByRole("button", { name: "START INVESTIGATION" }));

    expect(push).toHaveBeenCalledWith("/sign-in");

    const persisted = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(persisted.jobInput).toBe(PASTED_POSTING);
    // No auth fields exist on flow state anymore (see task-7 trim of
    // lib/flow-context.tsx) — the draft is the only thing carried.
    expect(persisted).not.toHaveProperty("signedIn");
    expect(persisted).not.toHaveProperty("authEmail");
    landing.unmount();

    // --- 2. SIGN-IN: the QueuedCard reads the carried draft back out of flow state ---
    render(
      <FlowProvider>
        {await SignInPage()}
      </FlowProvider>,
    );

    expect(await screen.findByText(PASTED_POSTING)).toBeTruthy();
  });
});
