"""Deterministic checks orchestrator.

Combines every no-LLM signal into the `deterministic_signals` dict the
rubric consumes: domain age, MX validity, email<->company-domain match,
homoglyph hit, ATS-domain legitimizer, and basic URL heuristics (spec §2).
Each sub-check degrades to None independently — a failed lookup is
"unavailable," never "suspicious" (spec §7).

`domain_age_days` and `has_valid_mx` are imported and called by their
bare module-level names so tests can monkeypatch them directly on this
module.
"""
from datetime import date
from app.tools.rdap import domain_age_days
from app.tools.dns_checks import has_valid_mx
from app.checks.ats_allowlist import is_ats_domain
from app.checks.homoglyph import homoglyph_hit


def _email_domain(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    return email.rsplit("@", 1)[1].lower()


def _url_flags(url: str | None) -> list[str]:
    flags: list[str] = []
    if not url:
        return flags
    low = url.lower()
    if low.startswith("http://") and not low.startswith("https://"):
        flags.append("no_tls")
    if any(s in low for s in ("bit.ly/", "tinyurl.com/", "t.co/")):
        flags.append("shortener")
    return flags


async def run_deterministic_checks(entities, *, today: date) -> dict:
    company_domain = (entities.company_domain or "").lower() or None
    email_domain = _email_domain(entities.recruiter_email)
    real_domain = (entities.candidate_real_domain or "").lower() or None

    age = await domain_age_days(company_domain, today=today) if company_domain else None
    mx = await has_valid_mx(company_domain) if company_domain else None

    email_matches = None
    if email_domain and company_domain:
        email_matches = email_domain == company_domain

    return {
        "domain_age_days": age,
        "mx_valid": mx,
        "email_domain_matches": email_matches,
        "homoglyph_hit": homoglyph_hit(company_domain, real_domain) if company_domain else False,
        "recruiter_is_ats": is_ats_domain(email_domain) if email_domain else False,
        "url_flags": _url_flags(getattr(entities, "job_url", None)),
    }
