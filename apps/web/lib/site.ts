import type { Metadata } from "next";

// The canonical production origin. Overridable per-environment (preview
// deploys, local prod builds) but defaults to the live host so every
// absolute URL — canonical, Open Graph, sitemap, robots — resolves without
// any env wiring in the common case.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobverifai.ronmrcdo.dev"
).replace(/\/$/, "");

export const SITE_NAME = "Jobverifai";

// The one-line pitch, reused as the meta description and the OG/Twitter
// description. Kept in sync with the terms-page intro (lib is the source of
// truth) so search snippets and the legal copy tell the same story.
export const SITE_DESCRIPTION =
  "Jobverifai is a free tool that checks what can be verified about a job posting and shows the evidence, so you can spot a likely scam before you apply.";

const DEFAULT_TITLE = `${SITE_NAME} — Check a job posting before you apply`;

// Site-wide metadata defaults. The root layout spreads this; per-page
// `metadata` exports override only what differs (title, robots), inheriting
// metadataBase, Open Graph, and the Twitter card from here.
export const baseMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

// Applied by every page that must never reach a search index: the auth gate,
// the signed-in home, and per-user investigation reports.
export const NOINDEX: Metadata["robots"] = {
  index: false,
  follow: false,
};
