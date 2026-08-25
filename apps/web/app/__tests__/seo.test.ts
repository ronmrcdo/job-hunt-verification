import { describe, it, expect, vi } from "vitest";

// These page modules pull in the server Supabase client and data helpers at
// import time. We only read their `metadata` exports here, never render them,
// so stub the request-scoped dependencies to keep the import graph inert.
vi.mock("../../lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../../lib/investigations", () => ({
  getInvestigation: vi.fn(),
  recentInvestigations: vi.fn(),
}));

import { SITE_URL, SITE_NAME, baseMetadata } from "../../lib/site";
import robots from "../robots";
import sitemap from "../sitemap";
import { metadata as termsMeta } from "../terms/page";
import { metadata as privacyMeta } from "../privacy/page";
import { metadata as disclaimerMeta } from "../disclaimer/page";
import { metadata as signInMeta } from "../sign-in/page";
import { metadata as verifyMeta } from "../verify/page";
import { metadata as investigationMeta } from "../investigations/[id]/page";

describe("baseMetadata (site-wide defaults)", () => {
  it("sets metadataBase to the production origin", () => {
    expect((baseMetadata.metadataBase as URL).href).toBe("https://jobverifai.ronmrcdo.dev/");
    expect(SITE_URL).toBe("https://jobverifai.ronmrcdo.dev");
  });

  it("defines a default title and a per-page template", () => {
    const title = baseMetadata.title as { default: string; template: string };
    expect(title.default).toContain(SITE_NAME);
    expect(title.template).toBe(`%s — ${SITE_NAME}`);
  });

  it("has a substantive description (not the placeholder 'Investigation report')", () => {
    expect(baseMetadata.description).toBeTruthy();
    expect(baseMetadata.description).not.toBe("Investigation report");
    expect((baseMetadata.description as string).length).toBeGreaterThan(40);
  });

  it("declares Open Graph and a large-image Twitter card", () => {
    const og = baseMetadata.openGraph as Record<string, unknown>;
    expect(og.type).toBe("website");
    expect(og.siteName).toBe(SITE_NAME);
    expect(og.url).toBe(SITE_URL);
    const twitter = baseMetadata.twitter as Record<string, unknown>;
    expect(twitter.card).toBe("summary_large_image");
  });

  it("is indexable by default", () => {
    const r = baseMetadata.robots as { index: boolean; follow: boolean };
    expect(r.index).toBe(true);
    expect(r.follow).toBe(true);
  });
});

describe("robots.ts", () => {
  it("allows the root and disallows the private surfaces", () => {
    const result = robots();
    const rule = result.rules as { allow?: unknown; disallow?: string[] };
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(
      expect.arrayContaining(["/verify", "/sign-in", "/investigations/"]),
    );
  });

  it("points crawlers at the sitemap", () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap.ts", () => {
  const urls = sitemap().map((e) => e.url);

  it("lists every public page", () => {
    expect(urls).toEqual(
      expect.arrayContaining([
        SITE_URL,
        `${SITE_URL}/terms`,
        `${SITE_URL}/privacy`,
        `${SITE_URL}/disclaimer`,
      ]),
    );
  });

  it("never lists an auth-gated or per-user page", () => {
    expect(urls.some((u) => /\/(verify|sign-in|investigations)/.test(u))).toBe(false);
  });
});

describe("public page metadata uses bare titles (template supplies the suffix)", () => {
  it.each([
    ["terms", termsMeta],
    ["privacy", privacyMeta],
    ["disclaimer", disclaimerMeta],
  ] as const)("/%s title omits the manual '— Jobverifai' suffix", (_route, meta) => {
    expect(meta?.title).toBeTruthy();
    expect(meta?.title as string).not.toMatch(/Jobverifai/);
  });
});

describe("auth-gated and per-user pages are noindex", () => {
  it.each([
    ["sign-in", signInMeta],
    ["verify", verifyMeta],
    ["investigations/[id]", investigationMeta],
  ] as const)("/%s is excluded from indexing", (_route, meta) => {
    const r = meta?.robots as { index: boolean } | undefined;
    expect(r?.index).toBe(false);
  });
});
