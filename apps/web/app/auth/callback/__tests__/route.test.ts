import { describe, it, expect, vi, beforeEach } from "vitest";

const exchange = vi.fn();
vi.mock("../../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

import { GET } from "../route";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("auth callback", () => {
  beforeEach(() => {
    exchange.mockReset().mockResolvedValue({ error: null });
    process.env.APP_ALLOWED_HOSTS = "jobverifai.ronmrcdo.dev";
  });

  it("ignores an unlisted x-forwarded-host (L1)", async () => {
    const res = await GET(req("http://0.0.0.0:3000/auth/callback?code=abc", {
      "x-forwarded-host": "evil.example.com",
    }));
    const loc = res.headers.get("location")!;
    expect(loc).not.toContain("evil.example.com");
    expect(loc.endsWith("/verify")).toBe(true);
  });

  it("uses an allow-listed x-forwarded-host", async () => {
    const res = await GET(req("http://0.0.0.0:3000/auth/callback?code=abc", {
      "x-forwarded-host": "jobverifai.ronmrcdo.dev",
    }));
    expect(res.headers.get("location")).toBe(
      "https://jobverifai.ronmrcdo.dev/verify",
    );
  });

  it("redirects to sign-in when the code exchange fails (L2)", async () => {
    exchange.mockResolvedValue({ error: { message: "bad code" } });
    const res = await GET(req("http://0.0.0.0:3000/auth/callback?code=bad", {
      "x-forwarded-host": "jobverifai.ronmrcdo.dev",
    }));
    expect(res.headers.get("location")).toContain("/sign-in");
  });
});
