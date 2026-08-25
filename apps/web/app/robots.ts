import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// Crawlers may index the public marketing + legal surface only. Everything
// behind the auth gate (/sign-in, /verify) and every per-user report
// (/investigations/*) is disallowed — those are also `noindex` at the page
// level, so this is defence in depth for crawlers that read robots first.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/verify", "/sign-in", "/investigations/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
