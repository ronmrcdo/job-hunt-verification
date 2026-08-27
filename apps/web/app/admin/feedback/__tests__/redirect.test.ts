import { describe, it, expect, vi } from "vitest";

// vi.mock factories are hoisted above module-level const declarations, so
// redirect must be created via vi.hoisted to avoid a TDZ error (see
// app/sign-in/__tests__/page.test.tsx for the established pattern).
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT"); // Next's redirect() throws to halt rendering
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import AdminFeedbackRedirect from "../page";

describe("/admin/feedback", () => {
  it("permanently redirects to the consolidated /admin console", () => {
    expect(() => AdminFeedbackRedirect()).toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin");
  });
});
