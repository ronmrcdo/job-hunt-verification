import pytest
from datetime import date
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities
from app.graph.nodes import checks_node

@pytest.mark.asyncio
async def test_homoglyph_produces_suspicious_finding(monkeypatch):
    async def fake_checks(entities, *, today):
        return {"domain_age_days": 3, "mx_valid": True, "email_domain_matches": True,
                "homoglyph_hit": True, "recruiter_is_ats": False, "url_flags": []}
    monkeypatch.setattr(checks_node, "run_deterministic_checks", fake_checks)
    state = InvestigationState(
        submission=RawSubmission(job_text="x"),
        entities=ExtractedEntities(company_domain="acme-globall.com",
                                   candidate_real_domain="acme-global.com"))
    out = await checks_node.deterministic_checks_node(state)
    assert out["deterministic_signals"]["homoglyph_hit"] is True
    homoglyph = [f for f in out["findings"] if "lookalike" in f.claim.lower()]
    assert homoglyph and homoglyph[0].direction == "suspicious"
    assert homoglyph[0].provenance == "deterministic"
    assert homoglyph[0].source_ids  # cites a deterministic source

@pytest.mark.asyncio
async def test_ats_produces_legitimizing_finding(monkeypatch):
    async def fake_checks(entities, *, today):
        return {"domain_age_days": 900, "mx_valid": True, "email_domain_matches": True,
                "homoglyph_hit": False, "recruiter_is_ats": True, "url_flags": []}
    monkeypatch.setattr(checks_node, "run_deterministic_checks", fake_checks)
    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(recruiter_email="jo@lever.co"))
    out = await checks_node.deterministic_checks_node(state)
    ats = [f for f in out["findings"] if f.direction == "legitimizing"]
    assert any("applicant tracking" in f.claim.lower() or "ats" in f.claim.lower() for f in ats)
