import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above module-level const declarations, so
// getUser/redirect must be created via vi.hoisted to avoid a TDZ
// ReferenceError when the factories run at import time.
const { getUser, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import Page from "../page";

describe("/sign-in", () => {
  beforeEach(() => { getUser.mockReset(); redirect.mockClear(); });

  it("redirects an authenticated visitor to /verify", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.co" } } });
    await expect(Page()).rejects.toThrow("REDIRECT:/verify");
    expect(redirect).toHaveBeenCalledWith("/verify");
  });

  it("renders the sign-in form for an anonymous visitor", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const el = await Page();           // returns JSX, does not redirect
    expect(el).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
