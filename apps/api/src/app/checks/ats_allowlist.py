"""ATS (applicant tracking system) domain allowlist.

Job postings hosted on a known ATS domain (Greenhouse, Lever, Workday, ...)
are a legitimizing signal per spec §7.
"""
from app.checks.domain_match import matches_any

ATS_DOMAINS: frozenset[str] = frozenset({
    "greenhouse.io", "lever.co", "myworkday.com", "workday.com",
    "ashbyhq.com", "smartrecruiters.com", "icims.com", "bamboohr.com",
    "jobvite.com", "workable.com", "breezy.hr", "teamtailor.com",
})


def is_ats_domain(domain: str) -> bool:
    return matches_any(domain, ATS_DOMAINS)
