import { describe, it, expect } from "vitest";
import nextConfig from "./next.config.js";

describe("security headers", () => {
  it("sets frame, HSTS, nosniff, referrer, and CSP on all routes", async () => {
    const rules = await (nextConfig as any).headers();
    const all = rules.flatMap((r: any) => r.headers);
    const byKey = Object.fromEntries(all.map((h: any) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Strict-Transport-Security"]).toContain("max-age=");
    expect(byKey["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });
});
