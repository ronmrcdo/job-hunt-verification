import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlowProvider } from "../../lib/flow-context";

const push = vi.fn();

// Page is now an async server component that checks the session before
// rendering (task 3.1) — mock an anonymous visitor so it renders the form
// instead of redirecting to /verify.
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

import Page from "../sign-in/page";

const STORAGE_KEY = "jhv_flow";

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("Sign-in page", () => {
  it("shows the queued posting (jobInput) and its detection label from flow state", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ jobInput: "Assistant role, remote, flexible hours" }),
    );

    render(
      <FlowProvider>
        {await Page()}
      </FlowProvider>,
    );

    expect(await screen.findByText("Assistant role, remote, flexible hours")).toBeTruthy();
    expect(screen.getByText(/Job text detected/)).toBeTruthy();
  });

  it("renders the STEP 2 OF 3 micro label and the H1", async () => {
    render(
      <FlowProvider>
        {await Page()}
      </FlowProvider>,
    );

    expect(await screen.findByText(/STEP 2 OF 3/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: /SIGN IN TO RUN\s*THIS CHECK/ })).toBeTruthy();
  });
});
