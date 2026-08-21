from datetime import datetime, timezone
from app.graph.state import Source, Finding, FinalAssessment
from app.worker.persistence import shape


def test_shape_excerpts_and_defangs_everything_client_visible():
    src = Source(id="s1", url="http://evil.example/x", kind="fetched_page",
                 retrieved_at=datetime.now(timezone.utc), content_summary="c",
                 raw_excerpt="visit http://evil.example " + "A"*1000)
    find = Finding(id="f1", category="domain", direction="unverifiable", severity="info",
                   claim="see http://evil.example now", source_ids=["s1"], provenance="deterministic")
    assess = FinalAssessment(band="MODERATE", confidence="LOW",
                             summary="go to http://evil.example", coverage=0.5)
    sources, findings, assessment, verify = shape([src], [find], assess, ["check http://evil.example"])
    assert len(sources[0].raw_excerpt) <= 500                       # capped
    assert "http://" not in sources[0].raw_excerpt                  # defanged
    assert "http://" not in findings[0].claim
    assert "http://" not in assessment.summary
    assert "http://" not in verify[0]


import uuid
import pytest
from app.graph.steps import STEP_REGISTRY
from app.worker.persistence import Persistence


class FakeCursor:
    async def fetchall(self): return []
    async def fetchone(self): return None


class FakeConn:
    def __init__(self, store): self.store = store
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def execute(self, sql, params=None):
        self.store.append((sql, params))
        return FakeCursor()


class FakePool:
    def __init__(self): self.store = []
    def connection(self): return FakeConn(self.store)


async def test_step_marks_are_idempotent_upserts(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    inv = uuid.uuid4()
    await p.done(inv, "intake", None)
    await p.done(inv, "intake", None)   # replay must not error and must use ON CONFLICT

    assert len(pool.store) == 2
    for sql, params in pool.store:
        normalized = " ".join(sql.split()).upper()
        assert normalized.startswith("INSERT INTO INVESTIGATION_STEPS")
        assert "ON CONFLICT (INVESTIGATION_ID, STEP_KEY) DO UPDATE" in normalized


async def test_backfill_issues_pending_to_skipped_and_running_to_failed(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    inv = uuid.uuid4()
    await p.backfill(inv)

    assert len(pool.store) == 2
    sql0 = " ".join(pool.store[0][0].split()).upper()
    sql1 = " ".join(pool.store[1][0].split()).upper()
    assert "STATUS='SKIPPED'" in sql0 and "STATUS='PENDING'" in sql0
    assert "STATUS='FAILED'" in sql1 and "STATUS='RUNNING'" in sql1
    assert "FINISHED_AT=NOW()" in sql1


async def test_persist_result_writes_shaped_sources(monkeypatch):
    from app.worker.persistence import Persistence
    from app.graph.state import Source
    from datetime import datetime, timezone
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    src = Source(id="s1", url="http://evil.example/x", kind="fetched_page",
                 retrieved_at=datetime.now(timezone.utc), content_summary="c",
                 raw_excerpt="go http://evil.example " + "A" * 1000)
    p = Persistence()
    await p.persist_result(uuid.uuid4(), assessment=None, findings=[], sources=[src],
                           cost={}, what_to_verify=[], check_count=None)
    update = next(c for c in pool.store if "UPDATE INVESTIGATIONS" in c[0].upper())
    joined = " ".join(str(x) for x in update).lower()
    assert "sources" in joined
    assert "http://" not in joined            # defanged


async def test_persist_result_writes_defanged_title(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    await p.persist_result(uuid.uuid4(), assessment=None, findings=[], sources=[],
                           cost={}, what_to_verify=[], check_count=None,
                           title="Acme http://evil.example")
    update = next(c for c in pool.store if "UPDATE INVESTIGATIONS" in c[0].upper())
    sql = " ".join(update[0].split()).lower()
    assert "title=" in sql
    joined = " ".join(str(x) for x in update[1]).lower()
    assert "acme" in joined            # the derived title is written
    assert "http://" not in joined     # ...and defanged like other client-visible text


async def test_persist_result_title_defaults_to_null(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    await p.persist_result(uuid.uuid4(), assessment=None, findings=[], sources=[],
                           cost={}, what_to_verify=[], check_count=None)
    update = next(c for c in pool.store if "UPDATE INVESTIGATIONS" in c[0].upper())
    assert "title=" in " ".join(update[0].split()).lower()
    assert None in update[1]           # no title supplied -> stored NULL


async def test_set_status_running_stamps_started_at(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    inv = uuid.uuid4()
    await p.set_status(inv, "running")
    sql = " ".join(pool.store[0][0].split()).lower()
    assert "started_at=now()" in sql and "status=" in sql


async def test_set_status_terminal_does_not_touch_started_at(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    await p.set_status(uuid.uuid4(), "done")
    sql = " ".join(pool.store[0][0].split()).lower()
    assert "started_at" not in sql


async def test_zombie_running_measures_from_started_at_not_created_at(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    await p.zombie_running()
    sql = " ".join(pool.store[0][0].split()).lower()
    assert "started_at is not null" in sql
    assert "started_at < now()" in sql
    assert "created_at" not in sql  # no longer keyed off creation time


async def test_persist_result_with_status_is_single_atomic_update(monkeypatch):
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    p = Persistence()
    await p.persist_result(uuid.uuid4(), assessment=None, findings=[], sources=[],
                           cost={}, what_to_verify=[], check_count=None, status="done")
    updates = [c for c in pool.store if "update investigations" in c[0].lower()]
    assert len(updates) == 1
    sql = " ".join(updates[0][0].split()).lower()
    assert "status=" in sql and "assessment=" in sql  # both in the same UPDATE
