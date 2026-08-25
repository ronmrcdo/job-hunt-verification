import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// Only the publicly indexable pages belong here. The landing page leads;
// the three legal pages change rarely. Auth-gated and per-user routes are
// deliberately absent (they are `noindex` and robots-disallowed).
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: `${SITE_URL}/disclaimer`, lastModified, changeFrequency: "yearly", priority: 0.5 },
  ];
}
