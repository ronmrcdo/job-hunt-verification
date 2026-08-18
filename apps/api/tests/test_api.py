import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app import main
from app.config import settings
from app.graph.state import FinalAssessment, InvestigationState

pytestmark = pytest.mark.asyncio

TEST_DB_URL = os.getenv("JHV_TEST_DATABASE_URL")


async def _fake_run(submission, *, investigation_id):
    return InvestigationState(
        submission=submission,
        assessment=FinalAssessment(band="LOW", confidence="HIGH", summary="ok", coverage=0.8),
    )


async def test_create_and_fetch_investigation(monkeypatch):
    # Stub the graph run so route logic is under test, not the LLM/graph.
    monkeypatch.setattr(main, "run_investigation", _fake_run)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.post("/investigations", json={"job_text": "Acme hiring"},
                           headers={"X-Owner-Key": "owner-a"})
        assert r.status_code == 201
        inv_id = r.json()["id"]
        # id is a real UUIDv4
        assert uuid.UUID(inv_id).version == 4

        ok = await ac.get(f"/investigations/{inv_id}", headers={"X-Owner-Key": "owner-a"})
        assert ok.status_code == 200
        body = ok.json()
        assert body["assessment"]["band"] == "LOW"
        assert body["status"] == "done"
        assert body["findings"] == []
        assert "total_usd" in body["cost"]
        # Only canonical fields are ever exposed — no raw_* accumulator leak.
        assert "raw_findings" not in body
        assert "raw_sources" not in body

        # Foreign owner => 404, never 403 (no resource-existence leak).
        foreign = await ac.get(f"/investigations/{inv_id}", headers={"X-Owner-Key": "owner-b"})
        assert foreign.status_code == 404

        # Missing id => also 404.
        missing = await ac.get(f"/investigations/{uuid.uuid4()}", headers={"X-Owner-Key": "owner-a"})
        assert missing.status_code == 404


async def test_sources_are_excerpt_only(monkeypatch):
    from app.graph.state import RawSubmission, Source
    from datetime import datetime, timezone

    async def fake_run_with_source(submission, *, investigation_id):
        src = Source(id="src_1", url="https://acme.com", kind="fetched_page",
                     retrieved_at=datetime.now(timezone.utc),
                     content_summary="summary", raw_excerpt="x" * 1000)
        return InvestigationState(submission=submission, sources=[src])

    monkeypatch.setattr(main, "run_investigation", fake_run_with_source)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.post("/investigations", json={"job_text": "Acme hiring"},
                           headers={"X-Owner-Key": "owner-c"})
        inv_id = r.json()["id"]
        ok = await ac.get(f"/investigations/{inv_id}", headers={"X-Owner-Key": "owner-c"})
        assert len(ok.json()["sources"][0]["raw_excerpt"]) <= 500


async def test_rejects_oversized_paste():
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.post(
            "/investigations",
            json={"job_text": "x" * (settings.max_job_text_chars + 1)},
            headers={"X-Owner-Key": "owner-a"})
        assert r.status_code == 422


async def test_deadline_exceeded_does_not_hang(monkeypatch):
    import asyncio

    async def slow_run(submission, *, investigation_id):
        await asyncio.sleep(10)

    monkeypatch.setattr(main, "run_investigation", slow_run)
    monkeypatch.setattr(settings, "total_deadline_s", 0.05)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.post("/investigations", json={"job_text": "Acme hiring"},
                           headers={"X-Owner-Key": "owner-d"})
        assert r.status_code == 201
        inv_id = r.json()["id"]
        ok = await ac.get(f"/investigations/{inv_id}", headers={"X-Owner-Key": "owner-d"})
        assert ok.json()["status"] == "deadline_exceeded"


async def test_end_to_end_persists_and_fetches_via_postgres(monkeypatch):
    if not TEST_DB_URL:
        pytest.skip("set JHV_TEST_DATABASE_URL to run DB integration tests")
    from app import db
    monkeypatch.setattr(settings, "database_url", TEST_DB_URL)
    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)
    monkeypatch.setattr(db, "_pool", None)
    await db.init_tables()

    monkeypatch.setattr(main, "run_investigation", _fake_run)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        r = await ac.post("/investigations", json={"job_text": "Acme hiring, real pg"},
                           headers={"X-Owner-Key": "owner-pg"})
        assert r.status_code == 201
        inv_id = r.json()["id"]

        ok = await ac.get(f"/investigations/{inv_id}", headers={"X-Owner-Key": "owner-pg"})
        assert ok.status_code == 200
        assert ok.json()["assessment"]["band"] == "LOW"

        foreign = await ac.get(f"/investigations/{inv_id}", headers={"X-Owner-Key": "owner-other"})
        assert foreign.status_code == 404
