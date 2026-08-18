import os, uuid, pytest
from app import db

pytestmark = pytest.mark.asyncio

async def _db_up() -> bool:
    try:
        pool = await db.get_pool()
        async with pool.connection() as c: await c.execute("SELECT 1")
        return True
    except Exception:
        return False

async def test_sources_roundtrip():
    if not await _db_up():
        pytest.skip("no database")
    await db.init_tables()
    inv = uuid.uuid4()
    await db.save_raw_source(inv, "src_001", "https://x", "full raw html here")
    rows = await db.load_raw_sources(inv)
    assert rows[0]["source_id"] == "src_001"
    assert rows[0]["raw"] == "full raw html here"
