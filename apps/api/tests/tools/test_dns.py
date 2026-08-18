import pytest
from app.tools import dns_checks

@pytest.mark.asyncio
async def test_valid_mx(monkeypatch):
    monkeypatch.setattr(dns_checks, "_resolve_mx", lambda d: ["mx.acme.com"])
    assert await dns_checks.has_valid_mx("acme.com") is True

@pytest.mark.asyncio
async def test_no_mx(monkeypatch):
    monkeypatch.setattr(dns_checks, "_resolve_mx", lambda d: [])
    assert await dns_checks.has_valid_mx("nomx.com") is False

@pytest.mark.asyncio
async def test_lookup_failure_is_none(monkeypatch):
    def boom(d): raise RuntimeError("dns down")
    monkeypatch.setattr(dns_checks, "_resolve_mx", boom)
    assert await dns_checks.has_valid_mx("broken.com") is None
