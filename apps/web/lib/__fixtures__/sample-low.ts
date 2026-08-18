import type { Investigation } from "../api";

// Transcribed verbatim from the design handoff prototype's LOW_FINDINGS /
// LOW_CHECKS / summary (band === 'LOW') data, found in:
// "Investigator Prototype.dc.html" (support.js itself only carries the
// dc-runtime; the fixture data lives inline in the prototype's <script>).
//   - LOW_FINDINGS: F-01..F-05 (ok/susp/unv), susp is empty
//   - LOW_CHECKS: the 3-item "THREE CHECKS WORTH DOING ANYWAY" list
//   - LOW summary string
//
// Mapping notes: no LOW finding has `however`, so every `note` maps straight
// to `Finding.mitigation` (F-04, F-05); F-01..F-03 have neither and get null.
export const SAMPLE_LOW: {
  inv: Investigation;
  submitted: {
    jobTitle: string;
    company: string;
    recruiter: string;
    email: string;
  };
} = {
  inv: {
    id: "51a00442-0000-4000-8000-000000000002",
    status: "complete",
    assessment: {
      band: "LOW",
      confidence: "HIGH",
      summary:
        "This posting sits on Northwind Systems’ own careers domain, registered since 2011, and the recruiter writes from that same domain. The pay band matches published figures for the role, and nothing in the posting matches the patterns we check for. We could not confirm who your contact is, and nothing external describes how this company runs its interviews, so the checks below are still worth doing before you share documents.",
      coverage: 0.9,
    },
    cost: {},
    check_count: null,
    what_to_verify: [
      "Call the company's number listed on their official site — not the one from the recruiter.",
      "Ask for a video call with the named hiring manager before you take any unpaid task.",
      "Get the pay, hours and start date in writing before sharing your ID or bank details.",
    ],
    sources: [
      {
        id: "s-lo-01",
        url: "https://northwind-systems.com/careers",
        kind: "fetched_page",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "northwind-systems[.]com/careers",
        raw_excerpt:
          '"Customer Operations Associate · Remote (US) · posted 6 days ago" — same title, pay band and description as the link you sent.',
      },
      {
        id: "s-lo-02",
        url: null,
        kind: "whois",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "registrar WHOIS",
        raw_excerpt:
          '"Creation date: 2011-09-14 · Registrant org: Northwind Systems Inc · Country: US"',
      },
      {
        id: "s-lo-03",
        url: null,
        kind: "dns",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "mail records",
        raw_excerpt:
          "The sending domain matches the careers domain and has published mail records dating back years.",
      },
      {
        id: "s-lo-04",
        url: null,
        kind: "search_result",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "public salary aggregator",
        raw_excerpt:
          '"Customer operations associate, remote, US: $52,000–$68,000." The posted band sits inside it.',
      },
      {
        id: "s-lo-05",
        url: "https://northwind-systems.com",
        kind: "fetched_page",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "company site",
        raw_excerpt: "No staff directory is published, so the name could not be matched.",
      },
      {
        id: "s-lo-06",
        url: null,
        kind: "user_provided",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "posting text",
        raw_excerpt:
          '"Two short conversations and a paid trial task." Nothing external describes how this company actually hires.',
      },
    ],
    findings: [
      {
        id: "F-01",
        category: "job",
        direction: "legitimizing",
        severity: "info",
        claim: "The posting is published on the company's own careers domain",
        source_ids: ["s-lo-01", "s-lo-02"],
        provenance: "web_verified",
        mitigation: null,
      },
      {
        id: "F-02",
        category: "recruiter",
        direction: "legitimizing",
        severity: "info",
        claim: "The recruiter writes from the company domain",
        source_ids: ["s-lo-03"],
        provenance: "web_verified",
        mitigation: null,
      },
      {
        id: "F-03",
        category: "job",
        direction: "legitimizing",
        severity: "info",
        claim: "The pay band matches published figures for this role",
        source_ids: ["s-lo-04"],
        provenance: "web_verified",
        mitigation: null,
      },
      {
        id: "F-04",
        category: "recruiter",
        direction: "unverifiable",
        severity: "medium",
        claim: "We could not confirm who your contact is",
        source_ids: ["s-lo-05"],
        provenance: "web_verified",
        mitigation:
          "Absence of a public record is weak evidence in either direction. Asking for a video call settles it quickly.",
      },
      {
        id: "F-05",
        category: "company",
        direction: "unverifiable",
        severity: "medium",
        claim: "The interview process described in the posting could not be checked",
        source_ids: ["s-lo-06"],
        provenance: "web_verified",
        mitigation:
          "Normal for a small employer — worth confirming in writing before you take unpaid steps.",
      },
    ],
  },
  submitted: {
    jobTitle: "Customer Operations Associate",
    company: "Northwind Systems",
    recruiter: "Dana Whitfield · email",
    email: "dana.whitfield@northwind-systems.com",
  },
};
