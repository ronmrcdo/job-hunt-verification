import os, uuid, pytest
from app import db
from app.config import settings

pytestmark = pytest.mark.asyncio

TEST_DB_URL = os.getenv("JHV_TEST_DATABASE_URL")


async def test_sources_roundtrip(monkeypatch):
    if not TEST_DB_URL:
        pytest.skip("set JHV_TEST_DATABASE_URL to run DB integration tests")
    monkeypatch.setattr(settings, "database_url", TEST_DB_URL)
    monkeypatch.setattr(db, "_pool", None)

    await db.init_tables()
    inv = uuid.uuid4()
    await db.save_raw_source(inv, "src_001", "https://x", "full raw html here")
    rows = await db.load_raw_sources(inv)
    assert rows[0]["source_id"] == "src_001"
    assert rows[0]["raw"] == "full raw html here"
