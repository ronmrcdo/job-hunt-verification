from datetime import date
import json, httpx, respx, pytest
from app.tools.rdap import domain_age_days

@pytest.mark.asyncio
@respx.mock
async def test_domain_age_from_registration(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    body = {"events": [{"eventAction": "registration", "eventDate": "2020-01-01T00:00:00Z"}]}
    respx.get("https://93.184.216.34/domain/acme.com").mock(
        return_value=httpx.Response(200, text=json.dumps(body)))
    assert await domain_age_days("acme.com", today=date(2020, 1, 31)) == 30

@pytest.mark.asyncio
@respx.mock
async def test_unavailable_rdap_returns_none(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    respx.get("https://93.184.216.34/domain/weird.zz").mock(return_value=httpx.Response(404))
    assert await domain_age_days("weird.zz", today=date(2026, 1, 1)) is None

@pytest.mark.asyncio
@respx.mock
async def test_null_event_date_returns_none(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    body = {"events": [{"eventAction": "registration", "eventDate": None}]}
    respx.get("https://93.184.216.34/domain/nulldate.com").mock(
        return_value=httpx.Response(200, text=json.dumps(body)))
    assert await domain_age_days("nulldate.com", today=date(2020, 1, 31)) is None

@pytest.mark.asyncio
@respx.mock
async def test_non_dict_body_returns_none(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    respx.get("https://93.184.216.34/domain/listbody.com").mock(
        return_value=httpx.Response(200, text=json.dumps([1, 2, 3])))
    assert await domain_age_days("listbody.com", today=date(2020, 1, 31)) is None
