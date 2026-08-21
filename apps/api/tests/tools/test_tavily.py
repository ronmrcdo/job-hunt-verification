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


@pytest.mark.asyncio
async def test_tavily_search_drops_malformed_and_non_http_urls(monkeypatch):
    # Search hits with junk URLs must not reach the graph nodes: a malformed
    # netloc later crashes urlparse (defang/SSRF), and a non-http URL is not
    # usable, citable evidence. Filter at this single boundary so both
    # crosspost and research only ever see well-formed http(s) hits.
    def fake_search(query, max_results, search_depth):
        return {"results": [
            {"title": "good", "url": "https://good.com/a", "content": "c"},
            {"title": "bad-netloc", "url": "http://exa[mple].com/x", "content": "c"},
            {"title": "no-scheme", "url": "ftp://x.com/f", "content": "c"},
            {"title": "empty", "url": "", "content": "c"},
        ]}
    monkeypatch.setattr(tavily, "_raw_search", fake_search)
    hits = await tavily.tavily_search("q")
    assert [h.url for h in hits] == ["https://good.com/a"]


def test_crosspost_queries_with_title_and_company():
    ent = SimpleNamespace(company_name="Acme Global", company_domain="acme.com",
                          job_title="Engineer", salary=None, key_phrases=[])
    qs = tavily.build_crosspost_queries(ent)
    assert qs == [
        '"Engineer" "Acme Global" job posting',
        '"Engineer" Acme Global apply contact email',
    ]


def test_crosspost_queries_empty_when_no_job_title():
    ent = SimpleNamespace(company_name="Acme Global", company_domain="acme.com",
                          job_title="", salary=None, key_phrases=[])
    assert tavily.build_crosspost_queries(ent) == []

    ent2 = SimpleNamespace(company_name="Acme Global", company_domain="acme.com",
                           job_title=None, salary=None, key_phrases=[])
    assert tavily.build_crosspost_queries(ent2) == []


def test_crosspost_queries_omit_company_clause_when_company_name_missing():
    ent = SimpleNamespace(company_name=None, company_domain=None,
                          job_title="Engineer", salary=None, key_phrases=[])
    qs = tavily.build_crosspost_queries(ent)
    assert qs
    for q in qs:
        assert '""' not in q
