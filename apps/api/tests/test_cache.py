import os
import pytest
from app import cache, db
from app.config import settings
from app.graph.state import RawSubmission

pytestmark = pytest.mark.asyncio

TEST_DB_URL = os.getenv("JHV_TEST_DATABASE_URL")


def test_dedupe_key_normalizes_url():
    k1 = cache.dedupe_key(RawSubmission(job_text="x", job_url="https://Acme.com/Jobs/1?utm=x"))
    k2 = cache.dedupe_key(RawSubmission(job_text="x", job_url="https://acme.com/Jobs/1"))
    assert k1 == k2
    assert cache.dedupe_key(RawSubmission(job_text="x")) is None


async def test_cache_roundtrip_and_count(monkeypatch):
    if not TEST_DB_URL:
        pytest.skip("set JHV_TEST_DATABASE_URL to run DB integration tests")
    monkeypatch.setattr(settings, "database_url", TEST_DB_URL)
    monkeypatch.setattr(db, "_pool", None)

    await db.init_tables()
    key = "https://acme.com/jobs/42"
    await cache.put_cached_report(key, {"band": "LOW"})
    assert (await cache.get_cached_report(key))["band"] == "LOW"
    assert await cache.bump_check_count(key) >= 2
