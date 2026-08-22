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
    assert len(out["raw_sources"]) >= 1
    s = out["raw_sources"][0]
    assert s.kind in ("fetched_page", "search_result")
    assert "SaaS" in s.content_summary
    assert len(s.raw_excerpt) <= 2000  # bounded excerpt, never full HTML
    assert out["cost_events"][0].usd == 0.001

@pytest.mark.asyncio
async def test_summarization_is_page_capped_and_concurrency_bounded(monkeypatch):
    # A single-slot local LLM serializes concurrent calls, so company_research
    # must not fan out 10-wide: it caps the number of pages summarized and the
    # number of summaries in flight at once (config knobs).
    import asyncio
    from app.config import settings

    async def fake_search(query, *, max_results=5):
        return [SearchHit(title=f"h{i}", url=f"https://acme.com/{i}", content="c") for i in range(20)]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=True, status=200, text="Acme is a real SaaS company.")

    inflight = 0
    peak = 0
    calls = 0
    async def fake_call(model, schema, messages, *, node):
        nonlocal inflight, peak, calls
        calls += 1
        inflight += 1
        peak = max(peak, inflight)
        await asyncio.sleep(0)  # let siblings pile up if unbounded
        inflight -= 1
        return schema(summary="Acme is an established SaaS company.", relevant=True), \
            NodeUsage(node=node, model="cheap", usd=0.001)

    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    monkeypatch.setattr(research, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme", company_domain="acme.com"))
    out = await research.company_research(state)
    assert calls == settings.research_max_pages
    assert peak <= settings.research_concurrency
    assert len(out["raw_sources"]) == settings.research_max_pages


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

@pytest.mark.asyncio
async def test_summarization_prompt_threads_target_company_identity(monkeypatch):
    # spec §7: the model can only disambiguate a same-named-but-different
    # company if it's told which company is under investigation.
    async def fake_search(query, *, max_results=5):
        return [SearchHit(title="Acme Careers", url="https://acme.com/jobs", content="hiring")]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=True, status=200, text="Acme is a real SaaS company.")
    seen = {}
    async def fake_call(model, schema, messages, *, node):
        seen["messages"] = messages
        return schema(summary="Acme appears to be an established SaaS company.",
                      relevant=True), NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    monkeypatch.setattr(research, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme Global", company_domain="acmeglobal.com"))
    await research.company_research(state)
    user_text = next(text for role, text in seen["messages"] if role == "user")
    assert "Acme Global" in user_text
    assert "acmeglobal.com" in user_text

@pytest.mark.asyncio
async def test_off_target_hit_excluded_from_sources(monkeypatch):
    # A same-named-but-different company (disambiguation gate) must be
    # excluded from returned sources, not mistaken for verification.
    async def fake_search(query, *, max_results=5):
        return [SearchHit(title="Acme Global (unrelated)", url="https://acme-global.example/about", content="hi")]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=True, status=200, text="Acme Global is a bakery in a different country.")
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="This page describes an unrelated bakery, not the target company.",
                      relevant=False), NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    monkeypatch.setattr(research, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme Global", company_domain="acmeglobal.com"))
    out = await research.company_research(state)
    assert out["raw_sources"] == []


@pytest.mark.asyncio
async def test_research_confirms_domain_when_relevant_source_matches(monkeypatch):
    # spec §9.7 Gap A: a relevant source whose page host registrable-matches
    # the submitted company_domain confirms it as the web-verified canonical
    # domain (only research sets this scalar).
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
    assert out["verified_canonical_domain"] == "acme.com"


@pytest.mark.asyncio
async def test_research_does_not_confirm_domain_from_off_target_hit(monkeypatch):
    # A same-named-but-different entity (relevant=False, dropped as evidence)
    # must not confirm the domain -- conservative rule.
    async def fake_search(query, *, max_results=5):
        return [SearchHit(title="Acme Global (unrelated)", url="https://acme-global.example/about", content="hi")]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=True, status=200, text="Acme Global is a bakery in a different country.")
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="This page describes an unrelated bakery, not the target company.",
                      relevant=False), NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    monkeypatch.setattr(research, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme Global", company_domain="acmeglobal.com"))
    out = await research.company_research(state)
    assert out["verified_canonical_domain"] is None


@pytest.mark.asyncio
async def test_research_does_not_confirm_domain_when_no_source_host_matches(monkeypatch):
    # A relevant source that just doesn't happen to be hosted on the claimed
    # domain must not confirm it either.
    async def fake_search(query, *, max_results=5):
        return [SearchHit(title="Acme mentioned in news", url="https://news.example/acme-story", content="news")]
    async def fake_fetch(url, *, max_bytes=2_000_000):
        return FetchResult(url=url, ok=True, status=200, text="Acme is a real SaaS company, per this news site.")
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="News coverage of Acme, a SaaS company.",
                      relevant=True), NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(research, "tavily_search", fake_search)
    monkeypatch.setattr(research, "safe_fetch", fake_fetch)
    monkeypatch.setattr(research, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                              entities=ExtractedEntities(company_name="Acme", company_domain="acme.com"))
    out = await research.company_research(state)
    assert out["verified_canonical_domain"] is None
