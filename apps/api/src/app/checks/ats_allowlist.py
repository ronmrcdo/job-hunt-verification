"""ATS (applicant tracking system) domain allowlist.

Job postings hosted on a known ATS domain (Greenhouse, Lever, Workday, ...)
are a legitimizing signal per spec §7.
"""

ATS_DOMAINS: frozenset[str] = frozenset({
    "greenhouse.io", "lever.co", "myworkday.com", "workday.com",
    "ashbyhq.com", "smartrecruiters.com", "icims.com", "bamboohr.com",
    "jobvite.com", "workable.com", "breezy.hr", "teamtailor.com",
})


def _registrable_suffix_match(domain: str, ats: str) -> bool:
    d = domain.lower().rstrip(".")
    return d == ats or d.endswith("." + ats)


def is_ats_domain(domain: str) -> bool:
    return any(_registrable_suffix_match(domain, a) for a in ATS_DOMAINS)
