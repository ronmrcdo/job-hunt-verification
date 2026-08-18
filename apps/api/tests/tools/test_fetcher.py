import httpx, respx, pytest
from app.tools.fetcher import safe_fetch

@pytest.mark.asyncio
@respx.mock
async def test_fetches_public_page(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    # Pinned: the client must connect to the validated IP, not re-resolve
    # "example.com" itself — the mock is only registered on the IP URL.
    route = respx.get("https://93.184.216.34/job").mock(
        return_value=httpx.Response(200, text="<html>Senior Engineer</html>"))
    r = await safe_fetch("https://example.com/job")
    assert r.ok and r.status == 200
    assert "Senior Engineer" in r.text
    assert route.called
    sent = route.calls.last.request
    # Original hostname preserved via Host header + SNI, even though the
    # connection target was the pinned IP.
    assert sent.headers["Host"] == "example.com"
    assert sent.extensions.get("sni_hostname") == "example.com"
    assert r.url == "https://example.com/job"

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
    respx.get("https://93.184.216.34/").mock(side_effect=httpx.TimeoutException("t"))
    r = await safe_fetch("https://slow.example.com/")
    assert r.ok is False and "timeout" in r.error.lower()

@pytest.mark.asyncio
@respx.mock
async def test_redirect_to_private_target_is_soft_failure(monkeypatch):
    def _resolve(host):
        if host == "internal.example.com":
            return ["127.0.0.1"]
        return ["93.184.216.34"]
    monkeypatch.setattr("app.security.ssrf._resolve", _resolve)
    respx.get("https://93.184.216.34/start").mock(
        return_value=httpx.Response(
            302, headers={"Location": "https://internal.example.com/secret"}))
    r = await safe_fetch("https://safe.example.com/start")
    assert r.ok is False
    assert r.error and ("non-public" in r.error.lower() or "redirect" in r.error.lower())

@pytest.mark.asyncio
@respx.mock
async def test_redirect_hop_is_also_pinned(monkeypatch):
    # Every hop gets its own resolve+validate+pin, not just the first URL.
    def _resolve(host):
        return {"safe.example.com": ["93.184.216.34"], "next.example.com": ["93.184.216.99"]}[host]
    monkeypatch.setattr("app.security.ssrf._resolve", _resolve)
    respx.get("https://93.184.216.34/start").mock(
        return_value=httpx.Response(302, headers={"Location": "https://next.example.com/final"}))
    route2 = respx.get("https://93.184.216.99/final").mock(
        return_value=httpx.Response(200, text="landed"))
    r = await safe_fetch("https://safe.example.com/start")
    assert r.ok is True
    assert "landed" in r.text
    assert route2.called
    assert route2.calls.last.request.headers["Host"] == "next.example.com"

@pytest.mark.asyncio
@respx.mock
async def test_oversize_body_is_truncated(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    respx.get("https://93.184.216.34/").mock(
        return_value=httpx.Response(200, text="A" * 1000))
    r = await safe_fetch("https://big.example.com/", max_bytes=100)
    assert r.ok is True
    assert len(r.text) <= 100

@pytest.mark.asyncio
@respx.mock
async def test_dns_rebinding_does_not_reach_second_resolution(monkeypatch):
    """Proof of the fix: a hostname that resolves to a public IP at
    validation time and would resolve to a *private* IP on a second lookup
    (the classic TOCTOU/rebinding attack — short-TTL DNS record flipped
    between validation and connect) must not let the connection reach the
    private address. We assert two things: (1) the resolver is called
    exactly once for the host (no second, connect-time lookup happens at
    all — httpx never gets a chance to re-resolve because it's handed the
    IP directly), and (2) the only network call respx observed targeted the
    validated public IP, never the rebound private one."""
    calls = []

    def _resolve(host):
        calls.append(host)
        # First (and, if the bug were present, only) call: public.
        # A real rebinding attack would have DNS answer differently on a
        # second lookup — e.g. 169.254.169.254 — but that second lookup
        # must never happen for the fix to hold.
        return ["93.184.216.34"]

    monkeypatch.setattr("app.security.ssrf._resolve", _resolve)
    route = respx.get("https://93.184.216.34/job").mock(
        return_value=httpx.Response(200, text="ok"))

    r = await safe_fetch("https://rebind.example.com/job")

    assert r.ok is True
    assert calls == ["rebind.example.com"]  # resolved exactly once
    assert route.called
    # respx has no other registered/observed route — nothing ever hit a
    # re-resolved (potentially rebound) address, since the client was
    # never given the hostname to resolve for the connection itself.
    assert route.calls.last.request.url.host == "93.184.216.34"
