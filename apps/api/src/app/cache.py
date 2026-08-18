import json
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, urlunparse
from app.db import get_pool
from app.graph.state import RawSubmission

def dedupe_key(submission: RawSubmission) -> str | None:
    if not submission.job_url:
        return None
    p = urlparse(submission.job_url)
    return urlunparse((p.scheme.lower(), (p.netloc or "").lower(), p.path.rstrip("/"), "", "", ""))

async def get_cached_report(key: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as c:
        cur = await c.execute(
            "SELECT value FROM cache WHERE key=%s AND expires_at > now()", (key,))
        row = await cur.fetchone()
        return row["value"] if row else None

async def put_cached_report(key: str, value: dict, *, ttl_hours: int = 48) -> None:
    expires = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    payload = json.dumps({**value, "_check_count": 1})
    pool = await get_pool()
    async with pool.connection() as c:
        await c.execute(
            "INSERT INTO cache (key, value, expires_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value=%s, expires_at=%s",
            (key, payload, expires, payload, expires))

async def bump_check_count(key: str) -> int:
    pool = await get_pool()
    async with pool.connection() as c:
        cur = await c.execute(
            "UPDATE cache SET value = jsonb_set(value, '{_check_count}', "
            "to_jsonb(COALESCE((value->>'_check_count')::int,1)+1)) "
            "WHERE key=%s RETURNING (value->>'_check_count')::int AS n", (key,))
        row = await cur.fetchone()
        return row["n"] if row else 1
