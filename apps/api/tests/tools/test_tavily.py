import pytest
from types import SimpleNamespace
from app.tools import tavily


def test_company_queries_cover_scam_and_careers():
    ent = SimpleNamespace(company_name="Acme Global", company_domain="acme.com",
                          job_title="Engineer", salary=None, key_phrases=[])
    qs = tavily.build_company_queries(ent)
    joined = " || ".join(qs).lower()
    assert "acme global" in joined
    assert any("scam" in q.lower() for q in qs)
    assert any("careers" in q.lower() for q in qs)


@pytest.mark.asyncio
async def test_tavily_search_maps_hits(monkeypatch):
    def fake_search(query, max_results, search_depth):
        return {"results": [{"title": "T", "url": "https://x", "content": "C"}]}
    monkeypatch.setattr(tavily, "_raw_search", fake_search)
    hits = await tavily.tavily_search("acme scam")
    assert hits[0].url == "https://x" and hits[0].title == "T"
