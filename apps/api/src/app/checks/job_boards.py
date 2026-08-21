"""Job-board domain denylist.

A posting read off LinkedIn/Indeed/ZipRecruiter carries the board's host, not
the employer's. Unlike the ATS allowlist this is not a legitimacy signal --
being on a board says nothing about the company (spec §7 treats cross-posting
as neutral). It exists so a board host is never mistaken for the employer's
own domain and scored by the deterministic checks: domain age, MX validity and
homoglyph distance measured against `linkedin.com` describe LinkedIn, and an
`email_domain_matches=False` against it is noise, not a signal.
"""
from app.checks.ats_allowlist import is_ats_domain
from app.checks.domain_match import matches_any

JOB_BOARD_DOMAINS: frozenset[str] = frozenset({
    "linkedin.com", "indeed.com", "ziprecruiter.com", "glassdoor.com",
    "monster.com", "dice.com", "simplyhired.com", "careerbuilder.com",
    "wellfound.com", "angel.co", "jobstreet.com", "seek.com.au",
    "totaljobs.com", "reed.co.uk", "craigslist.org", "remoteok.com",
    "weworkremotely.com", "flexjobs.com", "upwork.com", "freelancer.com",
})


def is_job_board_domain(domain: str) -> bool:
    return matches_any(domain, JOB_BOARD_DOMAINS)


def is_non_employer_domain(domain: str) -> bool:
    """True for any host that hosts postings on an employer's behalf -- board
    or ATS -- and therefore can never stand in for the employer's own domain."""
    return is_job_board_domain(domain) or is_ats_domain(domain)
