import uuid
from psycopg_pool import AsyncConnectionPool
from psycopg.rows import dict_row
from app.config import settings

_pool: AsyncConnectionPool | None = None

async def get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            settings.database_url, open=False,
            kwargs={"autocommit": True, "row_factory": dict_row})
        await _pool.open()
    return _pool

async def init_tables() -> None:
    pool = await get_pool()
    async with pool.connection() as c:
        await c.execute("""
            CREATE TABLE IF NOT EXISTS investigations (
              id UUID PRIMARY KEY,
              owner_key TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'running',
              submission JSONB NOT NULL,
              assessment JSONB,
              findings JSONB,
              cost JSONB,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now());
            CREATE TABLE IF NOT EXISTS sources (
              investigation_id UUID NOT NULL,
              source_id TEXT NOT NULL,
              url TEXT,
              raw TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              PRIMARY KEY (investigation_id, source_id));
            CREATE TABLE IF NOT EXISTS cache (
              key TEXT PRIMARY KEY,
              value JSONB NOT NULL,
              expires_at TIMESTAMPTZ NOT NULL);
        """)

async def save_raw_source(inv: uuid.UUID, source_id: str, url: str | None, raw: str) -> None:
    pool = await get_pool()
    async with pool.connection() as c:
        await c.execute(
            "INSERT INTO sources (investigation_id, source_id, url, raw) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT DO NOTHING", (inv, source_id, url, raw))

async def load_raw_sources(inv: uuid.UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as c:
        cur = await c.execute(
            "SELECT source_id, url, raw FROM sources WHERE investigation_id=%s ORDER BY source_id", (inv,))
        return await cur.fetchall()
