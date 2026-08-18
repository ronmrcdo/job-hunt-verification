import pytest
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities
from app.graph.nodes import crosspost
from app.tools.tavily import SearchHit


@pytest.mark.asyncio
async def test_contact_swap_flagged(monkeypatch):
    async def fake_search(q, *, max_results=5):
        return [SearchHit(title="Same job on BoardX", url="https://boardx/1",
                          content="Apply to hr-acme@gmail.com")]
    monkeypatch.setattr(crosspost, "tavily_search", fake_search)
    state = InvestigationState(
        submission=RawSubmission(job_text="Engineer role, contact jo@acme.com"),
        entities=ExtractedEntities(job_title="Engineer", company_name="Acme",
                                   recruiter_email="jo@acme.com"))
    out = await crosspost.job_crosspost_search(state)
    swaps = [f for f in out["findings"] if "different contact" in f.claim.lower()]
    assert swaps and swaps[0].direction == "suspicious"


@pytest.mark.asyncio
async def test_multiboard_same_contact_not_flagged(monkeypatch):
    async def fake_search(q, *, max_results=5):
        return [SearchHit(title="Same job on BoardX", url="https://boardx/1",
                          content="Apply to jo@acme.com")]
    monkeypatch.setattr(crosspost, "tavily_search", fake_search)
    state = InvestigationState(
        submission=RawSubmission(job_text="Engineer, contact jo@acme.com"),
        entities=ExtractedEntities(job_title="Engineer", company_name="Acme",
                                   recruiter_email="jo@acme.com"))
    out = await crosspost.job_crosspost_search(state)
    assert not [f for f in out["findings"] if "different contact" in f.claim.lower()]
