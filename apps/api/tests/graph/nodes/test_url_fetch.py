import pytest
from app.graph.state import InvestigationState, RawSubmission
from app.graph.nodes import url_fetch
from app.tools.fetcher import FetchResult


def test_fetch_target_prefers_job_url():
    sub = RawSubmission(job_text="anything", job_url="https://acme.co/careers/va")
    assert url_fetch.fetch_target(sub) == "https://acme.co/careers/va"


def test_fetch_target_falls_back_to_bare_url_in_job_text():
    sub = RawSubmission(job_text="  https://acme.co/careers/va  ")
    assert url_fetch.fetch_target(sub) == "https://acme.co/careers/va"


def test_fetch_target_ignores_url_embedded_in_prose():
    # A posting that mentions a URL is text, not a link submission.
    sub = RawSubmission(job_text="Acme is hiring, apply at http://acme.co")
    assert url_fetch.fetch_target(sub) is None


def test_fetch_target_none_when_neither():
    assert url_fetch.fetch_target(RawSubmission(job_text="just some posting text")) is None


@pytest.mark.asyncio
async def test_no_target_is_passthrough(monkeypatch):
    called = False
    async def fake_fetch(url, **kw):
        nonlocal called
        called = True
        return FetchResult(url=url, ok=True, text="x")
    monkeypatch.setattr(url_fetch, "safe_fetch", fake_fetch)

    out = await url_fetch.url_fetch(InvestigationState(submission=RawSubmission(job_text="plain text")))
    assert out == {}
    assert called is False


@pytest.mark.asyncio
async def test_ok_fetch_stores_capped_text(monkeypatch):
    monkeypatch.setattr(url_fetch.settings, "max_fetched_posting_chars", 10)
    async def fake_fetch(url, **kw):
        return FetchResult(url=url, ok=True, text="A" * 50)
    monkeypatch.setattr(url_fetch, "safe_fetch", fake_fetch)

    out = await url_fetch.url_fetch(InvestigationState(
        submission=RawSubmission(job_text="x", job_url="https://acme.co/j")))
    assert out == {"fetched_posting": "A" * 10}


@pytest.mark.asyncio
async def test_ssrf_failure_is_soft(monkeypatch):
    async def fake_fetch(url, **kw):
        return FetchResult(url=url, ok=False, error="ssrf: private range")
    monkeypatch.setattr(url_fetch, "safe_fetch", fake_fetch)

    out = await url_fetch.url_fetch(InvestigationState(
        submission=RawSubmission(job_text="x", job_url="https://169.254.169.254/")))
    assert out == {"fetch_failed": True}


@pytest.mark.asyncio
async def test_empty_body_is_failure(monkeypatch):
    async def fake_fetch(url, **kw):
        return FetchResult(url=url, ok=True, text="   ")
    monkeypatch.setattr(url_fetch, "safe_fetch", fake_fetch)

    out = await url_fetch.url_fetch(InvestigationState(
        submission=RawSubmission(job_text="x", job_url="https://acme.co/empty")))
    assert out == {"fetch_failed": True}
