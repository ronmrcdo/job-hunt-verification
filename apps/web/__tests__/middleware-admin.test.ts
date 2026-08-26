import { describe, it, expect, vi, beforeEach } from "vitest";

// updateSession is the existing Supabase session refresh; stub it so the test
// isolates the /admin header pre-check.
vi.mock("../lib/supabase/middleware", () => ({
  updateSession: vi.fn(() => new Response(null, { status: 200 })),
}));

import { middleware } from "../middleware";
import { updateSession } from "../lib/supabase/middleware";
import { NextRequest } from "next/server";

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(`https://app.example.com${path}`), { headers });
}

describe("middleware /admin pre-check", () => {
  beforeEach(() => {
    vi.mocked(updateSession).mockClear();
  });

  it("404s an /admin request with no Cf-Access-Jwt-Assertion header", async () => {
    const res = await middleware(req("/admin/feedback"));
    expect(res.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("lets an /admin request WITH the assertion header fall through to updateSession", async () => {
    const res = await middleware(req("/admin/feedback", { "cf-access-jwt-assertion": "x" }));
    expect(res.status).toBe(200);
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("does not gate non-admin routes", async () => {
    await middleware(req("/report/abc"));
    expect(updateSession).toHaveBeenCalledOnce();
  });

  it("does not gate /administrator (segment-exact match, not a prefix match)", async () => {
    const res = await middleware(req("/administrator"));
    expect(res.status).toBe(200);
    expect(updateSession).toHaveBeenCalledOnce();
  });
});
