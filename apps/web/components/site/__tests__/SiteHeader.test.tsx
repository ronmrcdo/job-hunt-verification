import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

function sessionWith(user: Record<string, unknown>) {
  return { data: { session: { user } } };
}

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

  it("signed-in: shows the auth display name (not the email) on the account trigger", async () => {
    getSession.mockResolvedValue(
      sessionWith({ email: "a@b.co", user_metadata: { full_name: "Ada Lovelace" } }),
    );

    render(<SiteHeader />);

    expect(getSession).toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    // The trigger carries the display name; the raw email is not in the bar.
    expect(await screen.findByRole("button", { name: /ada lovelace/i })).toBeTruthy();
    expect(screen.queryByText("a@b.co")).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check a job" })).toBeTruthy();
  });

  it("falls back to the email when no display name is set", async () => {
    getSession.mockResolvedValue(sessionWith({ email: "a@b.co" }));

    render(<SiteHeader />);

    expect(await screen.findByRole("button", { name: /a@b\.co/i })).toBeTruthy();
  });

  it("keeps sign-out inside a popover, hidden until the account trigger is opened", async () => {
    getSession.mockResolvedValue(
      sessionWith({ email: "a@b.co", user_metadata: { full_name: "Ada Lovelace" } }),
    );

    render(<SiteHeader />);

    const trigger = await screen.findByRole("button", { name: /ada lovelace/i });
    // Collapsed by default: no sign-out control on the bar itself.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Disclosure, not an ARIA menu: sign-out is a plain button in the panel.
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const signOutItem = await screen.findByRole("button", { name: /sign out/i });
    // The email is available as context inside the popover.
    expect(screen.getByText("a@b.co")).toBeTruthy();

    fireEvent.click(signOutItem);

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("closes the account popover on Escape", async () => {
    getSession.mockResolvedValue(
      sessionWith({ email: "a@b.co", user_metadata: { full_name: "Ada Lovelace" } }),
    );

    render(<SiteHeader />);

    const trigger = await screen.findByRole("button", { name: /ada lovelace/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull(),
    );
  });
});
