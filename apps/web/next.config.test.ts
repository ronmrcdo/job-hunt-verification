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

  it("allows the Cloudflare Turnstile origin in script-src and frame-src", async () => {
    const rules = await (nextConfig as any).headers();
    const all = rules.flatMap((r: any) => r.headers);
    const csp = all.find((h: any) => h.key === "Content-Security-Policy").value as string;
    const directive = (name: string) =>
      csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name)) ?? "";
    expect(directive("script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive("frame-src")).toContain("https://challenges.cloudflare.com");
  });
});
