import type { Investigation } from "../investigations";

// Transcribed verbatim from the design handoff prototype's HIGH_FINDINGS /
// HIGH_CHECKS / summary (band === 'HIGH') data, found in:
// "Investigator Prototype.dc.html" (support.js itself only carries the
// dc-runtime; the fixture data lives inline in the prototype's <script>).
//   - HIGH_FINDINGS: F-01..F-07 (ok/susp/unv)
//   - HIGH_CHECKS: the 4-item "FOUR CHECKS THAT WOULD SETTLE THIS" list
//   - HIGH summary string
//
// Mapping notes:
//   - prototype `severity` -> Finding.severity
//   - prototype `provenance: true` -> Finding.provenance: "user_provided_unverified"
//     (F-04, the training-fee finding sourced from the pasted conversation)
//   - prototype `however` -> Finding.mitigation (F-03 only)
//   - prototype `note` -> Finding.mitigation whenever the finding has no `however`
//     (F-04, F-05, F-06, F-07); none of the HIGH findings carry both, so `however`
//     never needs to win over `note` here. The hard invariant "exactly one
//     mitigation mentions Cross-posting" is about substring matching, not about
//     mitigation being unique overall — F-03's `however` is the only one that does.
export const SAMPLE_HIGH: {
  inv: Investigation;
} = {
  inv: {
    id: "4f2c1180-0000-4000-8000-000000000001",
    user_id: "9e7c5c9a-0000-4000-8000-0000000000aa",
    status: "done",
    created_at: "2026-08-18T09:41:00Z",
    submission: {
      job_text: "Virtual Assistant, $2,500/month",
      company_name: "Acme Global",
      recruiter_email: "acmeglobalcareers@gmail.com",
    },
    assessment: {
      band: "HIGH",
      confidence: "MODERATE",
      summary:
        "A company called Acme Global does appear to exist and operate a website registered to a US address, and the pay for this role is within a plausible range. The posting you were sent, though, points at a domain registered 11 days ago that closely resembles the established one, and the same listing appears on three job boards under three different contact emails. In the conversation you shared, the recruiter asks for a training fee — a request that does not occur in legitimate hiring. We could not confirm that John Smith works at Acme Global, and the role does not appear on the company’s own careers page.",
      coverage: 0.6,
    },
    cost: {},
    check_count: 3,
    what_to_verify: [
      "Call the company's number listed on their official site — not the one from the recruiter.",
      "Never pay money to get a job — legitimate employers don't charge for training or equipment.",
      "Compare the sender's address letter by letter against the company's real domain, then ask them to write from it.",
      "Ask for a video call with a named person and an offer letter before sharing your ID or bank details.",
    ],
    sources: [
      {
        id: "s-hi-01",
        url: "https://acmeglobal.com",
        kind: "fetched_page",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "acmeglobal[.]com",
        raw_excerpt:
          '"Acme Global LLC · 1120 Harrison Street, Suite 400, Oakland, CA" — from the site footer and the registrar record.',
      },
      {
        id: "s-hi-02",
        url: null,
        kind: "whois",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "registrar WHOIS",
        raw_excerpt:
          '"Creation date: 2014-03-06 · Registrant org: Acme Global LLC · Country: US"',
      },
      {
        id: "s-hi-03",
        url: null,
        kind: "search_result",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "public salary aggregator",
        raw_excerpt:
          '"Virtual assistant, remote, US: $1,900–$3,400 per month across 4,100 reported figures." $2,500 sits mid-range, so the pay itself is not a signal either way.',
      },
      {
        id: "s-hi-04",
        url: "https://jobs-hire-portal.co",
        kind: "search_result",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "jobs-hire-portal[.]co",
        raw_excerpt:
          '"Apply: acmeglobalcareers@gmail.com · Virtual Assistant · $2,500/month · immediate start"',
      },
      {
        id: "s-hi-05",
        url: "https://remote-listings.net",
        kind: "search_result",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "remote-listings[.]net",
        raw_excerpt:
          '"Contact: hr.acmeglobal.hiring@outlook.com" — same description text, different address.',
      },
      {
        id: "s-hi-06",
        url: "https://quickapply-jobs.org",
        kind: "search_result",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "quickapply-jobs[.]org",
        raw_excerpt: '"Message us on Telegram @acme_hiring_jsmith to begin onboarding."',
      },
      {
        id: "s-hi-07",
        url: null,
        kind: "user_provided",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "conversation you shared",
        raw_excerpt:
          '"Before onboarding, the training kit fee is $180, refundable with your first paycheck. Send via crypto or gift card today to hold your seat."',
      },
      {
        id: "s-hi-08",
        url: "https://acme-globall.com",
        kind: "whois",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "registrar WHOIS",
        raw_excerpt:
          '"Creation date: 2026-08-07 · Registrant: redacted for privacy · Registrar: low-cost reseller"',
      },
      {
        id: "s-hi-09",
        url: null,
        kind: "dns",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "mail records",
        raw_excerpt:
          "No mail server is configured on the new domain, which is why recruiter mail arrives from a free consumer address.",
      },
      {
        id: "s-hi-10",
        url: "https://acmeglobal.com",
        kind: "fetched_page",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "company site",
        raw_excerpt: "No staff or team directory published.",
      },
      {
        id: "s-hi-11",
        url: null,
        kind: "fetched_page",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "staff pages",
        raw_excerpt: "Two pages returned 404 at time of check.",
      },
      {
        id: "s-hi-12",
        url: null,
        kind: "search_result",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "web search",
        raw_excerpt: "No result ties this name to this company.",
      },
      {
        id: "s-hi-13",
        url: "https://acmeglobal.com/careers",
        kind: "fetched_page",
        retrieved_at: "2026-08-18T09:41:00Z",
        content_summary: "acmeglobal[.]com/careers",
        raw_excerpt: "Four open roles listed, none of them a virtual assistant position.",
      },
    ],
    findings: [
      {
        id: "F-01",
        category: "company",
        direction: "legitimizing",
        severity: "info",
        claim: "Acme Global operates a website registered to a US address",
        source_ids: ["s-hi-01", "s-hi-02"],
        provenance: "web_verified",
        mitigation: null,
      },
      {
        id: "F-02",
        category: "job",
        direction: "legitimizing",
        severity: "info",
        claim: "The salary range is plausible for this role",
        source_ids: ["s-hi-03"],
        provenance: "web_verified",
        mitigation: null,
      },
      {
        id: "F-03",
        category: "cross_source",
        direction: "suspicious",
        severity: "high",
        claim: "This posting appears on three job boards with three different contact emails",
        source_ids: ["s-hi-04", "s-hi-05", "s-hi-06"],
        provenance: "web_verified",
        mitigation:
          "Cross-posting is common on job boards; the differing contact emails, not the reposting itself, are what stands out.",
      },
      {
        id: "F-04",
        category: "communication",
        direction: "suspicious",
        severity: "critical",
        claim: "The recruiter asked for a training fee payment",
        source_ids: ["s-hi-07"],
        provenance: "user_provided_unverified",
        mitigation:
          "Advance payment for training, equipment, or onboarding is one of the most consistent markers in reported job scams, and the payment methods named here can't be reversed. We are reading your paste at face value; we cannot confirm who sent these messages.",
      },
      {
        id: "F-05",
        category: "domain",
        direction: "suspicious",
        severity: "high",
        claim:
          "The domain acme-globall[.]com was registered 11 days ago and closely resembles acmeglobal[.]com",
        source_ids: ["s-hi-08", "s-hi-09"],
        provenance: "deterministic",
        mitigation: "Shown defanged — we don't link to domains under investigation.",
      },
      {
        id: "F-06",
        category: "recruiter",
        direction: "unverifiable",
        severity: "medium",
        claim: "We could not confirm John Smith works at Acme Global",
        source_ids: ["s-hi-10", "s-hi-11", "s-hi-12"],
        provenance: "web_verified",
        mitigation:
          "Absence of a public record is weak evidence in either direction — many real employees leave no findable trace.",
      },
      {
        id: "F-07",
        category: "job",
        direction: "unverifiable",
        severity: "medium",
        claim: "The job does not appear on Acme Global's careers page",
        source_ids: ["s-hi-13"],
        provenance: "web_verified",
        mitigation:
          "Note that third-party recruiters legitimately post roles that never appear there, so this on its own is not a suspicious signal.",
      },
    ],
  },
};
