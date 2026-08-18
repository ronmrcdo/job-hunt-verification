import httpx, respx, pytest
from app.tools.fetcher import safe_fetch

@pytest.mark.asyncio
@respx.mock
async def test_fetches_public_page(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    respx.get("https://example.com/job").mock(
        return_value=httpx.Response(200, text="<html>Senior Engineer</html>"))
    r = await safe_fetch("https://example.com/job")
    assert r.ok and r.status == 200
    assert "Senior Engineer" in r.text

@pytest.mark.asyncio
async def test_ssrf_url_is_soft_failure(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["127.0.0.1"])
    r = await safe_fetch("http://localhost/admin")
    assert r.ok is False
    assert r.error and "non-public" in r.error.lower()

@pytest.mark.asyncio
@respx.mock
async def test_timeout_is_soft_failure(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    respx.get("https://slow.example.com/").mock(side_effect=httpx.TimeoutException("t"))
    r = await safe_fetch("https://slow.example.com/")
    assert r.ok is False and "timeout" in r.error.lower()
