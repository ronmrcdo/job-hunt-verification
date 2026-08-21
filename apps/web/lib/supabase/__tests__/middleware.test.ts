// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { updateSession } from "../middleware";

const req = (path: string) =>
  new NextRequest(new URL(`https://app.test${path}`));

const signedIn = () =>
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
const signedOut = () => getUser.mockResolvedValue({ data: { user: null } });

describe("updateSession auth routing", () => {
  beforeEach(() => getUser.mockReset());

  // The landing page is public for everyone: signed-in visitors reach the app
  // through the header's "Check a job" button, not an automatic bounce.
  it("leaves an authenticated visitor on /", async () => {
    signedIn();
    const res = await updateSession(req("/"));
    expect(res.status).toBe(200);
  });

  it("leaves an unauthenticated visitor on /", async () => {
    signedOut();
    const res = await updateSession(req("/"));
    expect(res.status).toBe(200);
  });

  it("redirects an unauthenticated visitor from /verify to /sign-in", async () => {
    signedOut();
    const res = await updateSession(req("/verify"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/sign-in");
  });

  it("does not redirect an authenticated visitor already on /verify", async () => {
    signedIn();
    const res = await updateSession(req("/verify"));
    expect(res.status).toBe(200);
  });
});
