import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "../SiteHeader";

const { getSession, getUser, signOut } = vi.hoisted(() => {
  return {
    getSession: vi.fn(),
    getUser: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
});

vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession, getUser, signOut } }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SiteHeader", () => {
  it("signed-out: shows Sign in link and Check a job button", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    render(<SiteHeader />);

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check a job" })).toBeTruthy();
  });

  it("signed-in: shows the auth email and a sign-out control, Check a job still present", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "a@b.co" } } } });

    render(<SiteHeader />);

    expect(getSession).toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(await screen.findByText("a@b.co")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check a job" })).toBeTruthy();
  });
});
