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
from app.checks.domain_match import registrable_suffix_match


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


async def run_deterministic_checks(entities, *, today: date, verified_canonical_domain: str | None = None) -> dict:
    company_domain = (entities.company_domain or "").lower() or None
    email_domain = _email_domain(entities.recruiter_email)
    ref = (verified_canonical_domain or "").lower() or None

    age = await domain_age_days(company_domain, today=today) if company_domain else None
    mx = await has_valid_mx(company_domain) if company_domain else None

    email_matches = None
    if email_domain and company_domain:
        email_matches = email_domain == company_domain

    # Gap A (spec §9.7): the homoglyph check must trust ONLY a web-verified
    # reference domain, never the LLM-extracted `candidate_real_domain` --
    # an attacker-controlled input the LLM could be tricked into echoing
    # back, which would launder a lookalike domain as "verified real".
    if company_domain is None:
        homoglyph: bool | str = False
    elif ref is None:
        homoglyph = "unknown"
    else:
        homoglyph = homoglyph_hit(company_domain, ref)

    ownership_confirmed = bool(
        ref and company_domain and registrable_suffix_match(company_domain, ref))

    return {
        "domain_age_days": age,
        "mx_valid": mx,
        "email_domain_matches": email_matches,
        "homoglyph_hit": homoglyph,
        "entity_ownership_confirmed": ownership_confirmed,
        "recruiter_is_ats": is_ats_domain(email_domain) if email_domain else False,
        "url_flags": _url_flags(getattr(entities, "job_url", None)),
    }
