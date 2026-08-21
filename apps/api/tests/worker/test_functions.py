import uuid, pytest
from app.graph.state import RawSubmission, InvestigationState, FinalAssessment, Source
from app.worker import functions
from datetime import datetime, timezone

class FakePersistence:
    def __init__(self, submission, cached=None):
        self._sub = submission; self.status = None; self.result = None; self.backfilled = False
        self.day_spend = 0.0; self.capacity_blocked = False
    async def get_submission(self, inv): return self._sub, "queued"
    async def set_status(self, inv, s): self.status = s
    async def persist_result(self, inv, **kw): self.result = kw
    async def backfill(self, inv): self.backfilled = True
    async def day_spend_usd(self): return self.day_spend
    async def mark_capacity_blocked(self, inv): self.capacity_blocked = True

async def test_success_marks_running_then_done_and_persists(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    async def run(inv, sub, sink): return InvestigationState(submission=sub), "done"
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)   # no cache
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "done" and p.result is not None

async def test_cache_hit_copies_report_bumps_count_and_writes_no_steps(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")
    async def cached(_k): return {"assessment": None, "findings": [], "sources": [],
                                  "cost": {}, "what_to_verify": []}
    async def bump(_k): return 4
    monkeypatch.setattr(functions.cache, "get_cached_report", cached)
    monkeypatch.setattr(functions.cache, "bump_check_count", bump)
    ran = False
    async def run(inv, sub, sink):
        nonlocal ran; ran = True; return InvestigationState(submission=sub), "done"
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "done" and ran is False and p.result["check_count"] == 4

async def test_persists_title_derived_from_entities(monkeypatch):
    from app.graph.state import ExtractedEntities
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    async def run(inv, sub, sink):
        st = InvestigationState(submission=sub,
                                entities=ExtractedEntities(company_name="Acme Corp"))
        return st, "done"
    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["title"] == "Acme Corp"


async def test_title_falls_back_to_job_title_when_no_company(monkeypatch):
    from app.graph.state import ExtractedEntities
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    async def run(inv, sub, sink):
        st = InvestigationState(submission=sub,
                                entities=ExtractedEntities(company_name=None,
                                                           job_title="Senior AI Engineer"))
        return st, "done"
    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["title"] == "Senior AI Engineer"


async def test_title_is_none_when_nothing_extracted(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    async def run(inv, sub, sink):
        return InvestigationState(submission=sub), "done"   # empty entities
    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["title"] is None


async def test_cache_hit_passes_cached_title(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")
    async def cached(_k): return {"assessment": None, "findings": [], "sources": [],
                                  "cost": {}, "what_to_verify": [], "title": "Cached Co"}
    async def bump(_k): return 2
    monkeypatch.setattr(functions.cache, "get_cached_report", cached)
    monkeypatch.setattr(functions.cache, "bump_check_count", bump)
    async def run(inv, sub, sink): return InvestigationState(submission=sub), "done"
    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["title"] == "Cached Co"


async def test_cache_write_includes_title(monkeypatch):
    from app.graph.state import ExtractedEntities
    captured = {}
    async def fake_put(key, value, **kw): captured["value"] = value
    async def fake_get(key): return None
    monkeypatch.setattr(functions.cache, "put_cached_report", fake_put)
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")
    monkeypatch.setattr(functions.cache, "get_cached_report", fake_get)

    class FakePersistenceLocal:
        async def get_submission(self, i):
            return RawSubmission(job_text="x", job_url="http://co.example"), "queued"
        async def set_status(self, *a): pass
        async def persist_result(self, *a, **k): pass
        async def day_spend_usd(self): return 0.0
        async def mark_capacity_blocked(self, inv): pass

    async def fake_run(inv, sub, p):
        st = _state_with(sources=[])
        st.entities = ExtractedEntities(company_name="Acme")
        return st, "done"

    await functions.handle_requested(uuid.uuid4(), persistence=FakePersistenceLocal(), run=fake_run)
    assert captured["value"]["title"] == "Acme"


async def test_timeout_persists_deadline_exceeded_without_raising(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    async def run(inv, sub, sink): return InvestigationState(submission=sub), "deadline_exceeded"
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "deadline_exceeded"        # clean return, gap #5

async def test_unexpected_error_raises_for_inngest_retry(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    async def run(inv, sub, sink): raise RuntimeError("boom")
    with pytest.raises(RuntimeError):
        await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)


async def test_global_ceiling_blocks_and_skips_graph(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    p.day_spend = 999.0
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    monkeypatch.setattr(functions.settings, "global_daily_usd_ceiling", 25.0)
    ran = False
    async def run(inv, sub, sink):
        nonlocal ran; ran = True; return InvestigationState(submission=sub), "done"
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "failed" and p.capacity_blocked is True and ran is False


async def test_under_ceiling_runs_normally(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    p.day_spend = 1.0
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    monkeypatch.setattr(functions.settings, "global_daily_usd_ceiling", 25.0)
    async def run(inv, sub, sink): return InvestigationState(submission=sub), "done"
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "done" and p.capacity_blocked is False and p.result is not None


async def test_handle_failure_sets_status_failed_and_backfills():
    p = FakePersistence(RawSubmission(job_text="x"))
    inv_id = uuid.uuid4()
    await functions.handle_failure(inv_id, persistence=p)
    assert p.status == "failed"
    assert p.backfilled is True


class FakeSweepPersistence:
    def __init__(self, stale_ids, zombie_ids):
        self._stale = stale_ids
        self._zombie = zombie_ids
        self.set_statuses = []
        self.backfilled = []
    async def stale_queued(self): return self._stale
    async def zombie_running(self): return self._zombie
    async def set_status(self, inv, s): self.set_statuses.append((inv, s))
    async def backfill(self, inv): self.backfilled.append(inv)

async def test_sweep_stale_queued(monkeypatch):
    stale_id = uuid.uuid4()
    zombie_id = uuid.uuid4()
    p = FakeSweepPersistence([stale_id], [zombie_id])
    emitted = []
    async def emit(inv_id): emitted.append(inv_id)
    await functions.handle_sweep(persistence=p, emit=emit)
    assert emitted == [stale_id]
    assert p.set_statuses == [(zombie_id, "failed")]
    assert p.backfilled == [zombie_id]


def _state_with(sources):
    return InvestigationState(
        submission=RawSubmission(job_text="x"),
        sources=sources,
        findings=[],
        assessment=None,
        cost_events=[],
        deterministic_signals={}
    )


async def test_cache_write_is_shaped_and_defanged(monkeypatch):
    from app.worker import functions
    captured = {}

    async def fake_put(key, value, **kw):
        captured["value"] = value

    async def fake_get(key):
        return None

    monkeypatch.setattr(functions.cache, "put_cached_report", fake_put)
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")
    monkeypatch.setattr(functions.cache, "get_cached_report", fake_get)

    src = Source(id="s1", url="http://evil.example/x", kind="fetched_page",
                 retrieved_at=datetime.now(timezone.utc), content_summary="c",
                 raw_excerpt="see http://evil.example " + "A" * 1000)

    class FakePersistence:
        async def get_submission(self, i):
            from app.graph.state import RawSubmission
            return RawSubmission(job_text="x", job_url="http://co.example"), "queued"
        async def set_status(self, *a): pass
        async def persist_result(self, *a, **k): pass
        async def day_spend_usd(self): return 0.0
        async def mark_capacity_blocked(self, inv): pass

    async def fake_run(inv, sub, p):
        from app.graph.state import InvestigationState  # returned state carries raw src
        state = _state_with(sources=[src])
        return state, "done"

    await functions.handle_requested(uuid.uuid4(), persistence=FakePersistence(), run=fake_run)

    blob = str(captured["value"])
    assert "http://" not in blob          # url + raw_excerpt defanged before cache
    # excerpt capped
    assert all(len(s.get("raw_excerpt", "")) <= 500 for s in captured["value"]["sources"])


async def test_persists_display_entities(monkeypatch):
    from app.graph.state import ExtractedEntities
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)

    async def run(inv, sub, sink):
        st = InvestigationState(submission=sub, entities=ExtractedEntities(
            company_name="Acme Global", job_title="Virtual Assistant", salary="$2,500/month",
            recruiter_name="John Smith", contact_channel="Telegram"))
        return st, "done"

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"] == {
        "company_name": "Acme Global", "job_title": "Virtual Assistant",
        "salary": "$2,500/month", "recruiter_name": "John Smith",
        "contact_channel": "Telegram",
    }


async def test_entities_is_none_when_nothing_extracted(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)

    async def run(inv, sub, sink):
        return InvestigationState(submission=sub), "done"

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"] is None


async def test_cache_hit_passes_cached_entities(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")

    async def cached(_k):
        return {"assessment": None, "findings": [], "sources": [], "cost": {},
                "what_to_verify": [], "title": "Acme Global",
                "entities": {"company_name": "Acme Global", "job_title": None,
                             "salary": None, "recruiter_name": None,
                             "contact_channel": None}}

    async def bump(_k):
        return 2

    monkeypatch.setattr(functions.cache, "get_cached_report", cached)
    monkeypatch.setattr(functions.cache, "bump_check_count", bump)

    async def run(inv, sub, sink):
        raise AssertionError("cache hit must not run the graph")

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"]["company_name"] == "Acme Global"


async def test_cache_hit_without_entities_persists_none(monkeypatch):
    # Reports cached before the entities column existed have no such key;
    # the read path must not KeyError on them.
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")

    async def cached(_k):
        return {"assessment": None, "findings": [], "sources": [], "cost": {},
                "what_to_verify": []}

    async def bump(_k):
        return 2

    monkeypatch.setattr(functions.cache, "get_cached_report", cached)
    monkeypatch.setattr(functions.cache, "bump_check_count", bump)

    async def run(inv, sub, sink):
        raise AssertionError("cache hit must not run the graph")

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"] is None


async def test_handle_requested_terminal_write_is_atomic(monkeypatch):
    from app.worker import functions
    calls = []

    class RecordingPersistence:
        async def get_submission(self, i):
            from app.graph.state import RawSubmission
            return RawSubmission(job_text="x"), "queued"   # no job_url -> no cache
        async def set_status(self, inv, status): calls.append(("set_status", status))
        async def persist_result(self, inv, **k): calls.append(("persist_result", k.get("status")))
        async def day_spend_usd(self): return 0.0
        async def mark_capacity_blocked(self, inv): pass

    async def fake_run(inv, sub, p):
        return _state_with(sources=[]), "done"

    await functions.handle_requested(uuid.uuid4(), persistence=RecordingPersistence(), run=fake_run)

    # 'running' set_status still happens; the TERMINAL write is a single
    # persist_result(status='done'), NOT persist_result + set_status('done').
    assert ("persist_result", "done") in calls
    assert ("set_status", "done") not in calls
    assert calls.count(("set_status", "running")) == 1
