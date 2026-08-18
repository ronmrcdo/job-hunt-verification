import pytest
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities
from app.graph.nodes import research
from app.tools.tavily import SearchHit
from app.tools.fetcher import FetchResult
from app.cost_tracker import NodeUsage

@pytest.mark.asyncio
async def test_company_research_summarizes_each_hit(monkeypatch):
    async def fake_search(query, *, max_results=5):
        return [SearchHit(title="Acme Careers", url="https://acme.com/jobs", content="hiring")]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=True, status=200, text="Acme is a real SaaS company.")
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="Acme appears to be an established SaaS company.",
                      relevant=True), NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    monkeypatch.setattr(research, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme", company_domain="acme.com"))
    out = await research.company_research(state)
    assert len(out["sources"]) >= 1
    s = out["sources"][0]
    assert s.kind in ("fetched_page", "search_result")
    assert "SaaS" in s.content_summary
    assert len(s.raw_excerpt) <= 2000  # bounded excerpt, never full HTML
    assert out["cost_events"][0].usd == 0.001

@pytest.mark.asyncio
async def test_failed_fetch_becomes_unresolved_not_crash(monkeypatch):
    async def fake_search(query, *, max_results=5):
        return [SearchHit(title="x", url="https://acme.com/404", content="")]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=False, error="request timeout")
    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme"))
    out = await research.company_research(state)
    assert out["unresolved_questions"]  # research incomplete, recorded not raised
