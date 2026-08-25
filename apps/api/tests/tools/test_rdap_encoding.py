import respx
import httpx
from datetime import date
from app.tools.rdap import domain_age_days


# pyproject sets asyncio_mode = "auto", so a bare `async def test_` runs without
# a marker — mirror the existing tests/tools/test_rdap.py style.
#
# safe_fetch pins the connection to the SSRF-validated IP (see fetcher.py) and
# sends the original hostname via the Host header/SNI rather than the URL, so
# — like tests/tools/test_rdap.py — DNS resolution must be monkeypatched and
# the respx route matched against the pinned IP, not the "rdap.org" literal.
@respx.mock
async def test_domain_segment_is_url_encoded(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    route = respx.get(url__regex=r"https://93\.184\.216\.34/domain/.*").mock(
        return_value=httpx.Response(200, json={"events": []}))
    await domain_age_days("evil.com/../../x?y=1", today=date(2026, 1, 1))
    called = str(route.calls[0].request.url)
    # The crafted path/query chars must be percent-encoded, not passed raw.
    assert "?y=1" not in called
    assert "/../" not in called
