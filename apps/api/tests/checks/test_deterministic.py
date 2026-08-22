from datetime import date
from types import SimpleNamespace
import pytest
from app.checks import deterministic


def ent(**kw):
    base = dict(company_domain="acme.com", recruiter_email="jo@acme.com",
               candidate_real_domain="acme.com", job_url=None)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_matching_email_domain(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(), today=date(2026, 1, 1), verified_canonical_domain="acme.com")
    assert sig["email_domain_matches"] is True
    assert sig["recruiter_is_ats"] is False
    assert sig["homoglyph_hit"] is False
    assert sig["domain_age_days"] == 900


@pytest.mark.asyncio
async def test_mismatched_email_domain(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(5))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(recruiter_email="jo@gmail.com"), today=date(2026, 1, 1))
    assert sig["email_domain_matches"] is False


@pytest.mark.asyncio
async def test_ats_recruiter_is_legitimizing(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(recruiter_email="jo@jobs.lever.co"), today=date(2026, 1, 1))
    assert sig["recruiter_is_ats"] is True


@pytest.mark.asyncio
async def test_homoglyph_domain_flagged(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(3))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(company_domain="acme-globall.com", candidate_real_domain="acme-global.com",
            recruiter_email="jo@acme-globall.com"), today=date(2026, 1, 1),
        verified_canonical_domain="acme-global.com")
    assert sig["homoglyph_hit"] is True


@pytest.mark.asyncio
async def test_unavailable_lookups_degrade_to_none(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(None))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(None))
    sig = await deterministic.run_deterministic_checks(ent(), today=date(2026, 1, 1))
    assert sig["domain_age_days"] is None
    assert sig["mx_valid"] is None


@pytest.mark.asyncio
async def test_url_flags_no_tls_and_shortener(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(job_url="http://bit.ly/abc123"), today=date(2026, 1, 1))
    assert "no_tls" in sig["url_flags"]
    assert "shortener" in sig["url_flags"]


@pytest.mark.asyncio
async def test_url_flags_empty_for_clean_https(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(job_url="https://acme.com/careers/123"), today=date(2026, 1, 1))
    assert sig["url_flags"] == []


@pytest.mark.asyncio
async def test_homoglyph_unknown_without_verified_reference(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(company_domain="acme-globall.com", candidate_real_domain="acme-global.com"),
        today=date(2026, 1, 1))
    assert sig["homoglyph_hit"] == "unknown"
    assert sig["entity_ownership_confirmed"] is False


@pytest.mark.asyncio
async def test_homoglyph_hit_with_verified_reference(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(company_domain="acme-globall.com", candidate_real_domain=None),
        today=date(2026, 1, 1), verified_canonical_domain="acme-global.com")
    assert sig["homoglyph_hit"] is True
    assert sig["entity_ownership_confirmed"] is False  # submitted != verified


@pytest.mark.asyncio
async def test_entity_ownership_confirmed_when_registrable_match(monkeypatch):
    monkeypatch.setattr(deterministic, "domain_age_days", lambda d, today: _val(900))
    monkeypatch.setattr(deterministic, "has_valid_mx", lambda d: _val(True))
    sig = await deterministic.run_deterministic_checks(
        ent(company_domain="acme.com", candidate_real_domain=None),
        today=date(2026, 1, 1), verified_canonical_domain="acme.com")
    assert sig["entity_ownership_confirmed"] is True
    assert sig["homoglyph_hit"] is False


async def _val(v):
    return v
