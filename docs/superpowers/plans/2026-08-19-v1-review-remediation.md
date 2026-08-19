# V1 Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two schema blockers and the correctness/UX issues surfaced by the V1 code review, so the `feat/job-hunt-verification-v0` branch is safe to apply to a Supabase database and merge.

**Architecture:** Two subsystems, fixed in one branch. Backend: add the missing `cache` table migration, enable deny-all RLS on all worker-only `public` tables, rebase zombie-detection on a real run-start timestamp, and make the terminal result+status write atomic. Web: server-redirect authenticated users away from `/sign-in`, stop fabricating a `MODERATE` band when the assessment is absent, and harden the Realtime overlay. Backend tests use the existing `FakePool` (no live DB); SQL correctness is guarded by static file assertions plus the operator-run `scripts/verify_rls.sql`.

**Tech Stack:** Python 3.12 (`uv`, `pytest`, `psycopg`), Supabase/Postgres migrations, Next.js 16 App Router / React 19 (`@supabase/ssr`), Vitest + Testing Library.

**Spec:**
- Backend — `docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md`
- Web — `docs/superpowers/specs/2026-08-19-v1-web-supabase-integration-design.md`

This plan implements the review findings recorded for this branch (web review: merge-with-fixes; backend review: no/with-fixes, two blockers). Read both specs alongside it.

## Global Constraints

- **NEVER touch a live database or run Supabase.** Do not run `supabase start`, `supabase db push/reset`, `supabase migration up`, `supabase gen types`, `psql`, or `npx inngest-cli`. Migration/SQL files are **authored and reviewed only**; the operator (Ron) applies them. SQL is verified by reading and by the static-file tests in this plan; `scripts/verify_rls.sql` is the operator's runtime backstop.
- **Migrations may be concurrently edited.** Another session touched the migration set during review (the base `investigations` table appeared mid-review). **Before editing or referencing any file under `supabase/migrations/`, re-read it.** This plan adds *new* migration files rather than editing existing ones, precisely to avoid a concurrent-edit conflict.
- **No commit steps.** This plan omits `git commit` entirely (Ron's rule). The operator commits. Do not add commit steps or pass `--author`/`Co-Authored-By`.
- **Statuses (unchanged):** investigation `queued → running → done | failed | deadline_exceeded`; step `pending | running | done | skipped | failed`.
- **The worker is the only writer of client-visible data** (backend spec §3). Everything client-readable is shaped (defanged + excerpt-capped) at write time via `persistence.shape()`.
- **Design tokens are FINAL** (memory `frontend-design-token-authority`) and **product rules stay enforced** (memory `frontend-api-reconciliation`): band is never a score, confidence is separate, URLs always defanged and never links, conversation-provenance label on `provenance === "user_provided_unverified"`, neutral "couldn't verify" copy. Web tests assert roles/text/`data-*`, **never Tailwind class names**. `MotionGlobalConfig.skipAnimations = true` stays in `vitest.setup.ts`.
- **No live-DB in tests.** Backend mocks the pool with `FakePool`; web mocks `@supabase/ssr` / supabase-js at the module boundary.
- Backend tests run from `apps/api` with `uv run pytest`. Web tests run from `apps/web` with `npm test` (`vitest run`); type-check with `npx tsc --noEmit`.

---

## File Structure

**Created (backend / SQL)**
- `supabase/migrations/20260819081000_worker_table_rls.sql` — creates the `cache` table and enables deny-all RLS on every worker-only `public` table (cache + the four checkpointer tables). One new file, so no existing migration is edited.
- `supabase/migrations/20260819082000_investigations_started_at.sql` — adds `investigations.started_at` and nulls it in the insert-defaults trigger.
- `apps/api/tests/migrations/test_worker_table_rls.py` — static assertions over the two new migration files and over `scripts/verify_rls.sql`.

**Modified (backend)**
- `apps/api/src/app/worker/persistence.py` — `set_status` stamps `started_at` on `'running'`; `persist_result` gains an atomic `status` param; `zombie_running` keys off `started_at`.
- `apps/api/src/app/worker/functions.py` — terminal writes go through the atomic `persist_result(..., status=...)`; cache-write shapes sources first.
- `scripts/verify_rls.sql` — new cases: cache + checkpointer non-exposure to an authenticated role.
- `apps/api/tests/worker/test_persistence.py`, `apps/api/tests/worker/test_functions.py` — new/updated tests (see tasks).

**Created (web)**
- (Task 3.2) inline `IncompleteReport` panel inside `InvestigationView.tsx` — no new file.

**Modified (web)**
- `apps/web/app/sign-in/page.tsx` — server component; redirects an authenticated visitor to `/verify`.
- `apps/web/lib/report-view-model.ts` — `toReportViewModel` no longer fabricates a band; adds `complete` and makes band/confidence/summary nullable.
- `apps/web/components/investigation/InvestigationView.tsx` — renders `IncompleteReport` when `!vm.complete`.
- `apps/web/lib/investigations-live.ts` — one-shot re-SELECT right after `.subscribe()`; monotonic `applyStepEvent`.
- `apps/web/components/site/SiteHeader.tsx` — `getSession()` instead of `getUser()`.
- Corresponding `__tests__` files under `apps/web`.

**Explicitly NOT in this plan (deferred, agreed low-priority):**
- Web review Minor #6 — the two pre-existing token-class test assertions in `FindingCard.test.tsx` / `product-rules.test.tsx`. They predate this branch and encode the semantic row-tint rule; leave them.
- Web review Minor #6 (check_count cosmetic): `check_count` NULL on the originating run. Covered as an optional step in Task 2.3; skip if it complicates the atomic write.

---

## Phase 1 — Worker-table schema safety

Closes backend review **Critical #1** (missing `cache` table crashes every `job_url` investigation), **Important #2** (RLS-off worker tables expose cross-tenant state), and **Minor #5/#8** (cache stores un-shaped sources; verify_rls backstop).

Scope note confirmed by grep: in the **worker** path only `cache` is reached (`functions.py` → `app.cache`). The legacy `sources` table and `db.init_tables()` are used **only by the V0 `main.py`** (`save_raw_source`/`load_raw_sources`), which the worker never calls — so this phase migrates `cache` only, not the legacy `sources` table.

### Task 1.1: `cache` table migration + deny-all RLS on all worker-only tables

**Files:**
- Create: `supabase/migrations/20260819081000_worker_table_rls.sql`
- Test: `apps/api/tests/migrations/test_worker_table_rls.py`

**Interfaces:**
- Produces: a `public.cache (key text pk, value jsonb not null, expires_at timestamptz not null)` table matching the columns `app/cache.py` queries (`key`, `value`, `expires_at`), plus `enable row level security` (no policies) on `cache`, `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/migrations/test_worker_table_rls.py`:

```python
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"
RLS = (MIGRATIONS / "20260819081000_worker_table_rls.sql").read_text().lower() \
    if (MIGRATIONS / "20260819081000_worker_table_rls.sql").exists() else ""

WORKER_TABLES = ["cache", "checkpoints", "checkpoint_blobs",
                 "checkpoint_writes", "checkpoint_migrations"]


def test_migration_creates_cache_table_matching_cache_py():
    assert "create table if not exists cache" in RLS
    # columns app/cache.py reads: key, value, expires_at
    for col in ("key", "value", "expires_at"):
        assert col in RLS


def test_rls_enabled_on_every_worker_only_table():
    for t in WORKER_TABLES:
        assert f"alter table {t} enable row level security" in RLS, t


def test_no_client_policies_on_worker_tables():
    # Deny-all == RLS on with zero policies. Service role still bypasses.
    assert "create policy" not in RLS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/migrations/test_worker_table_rls.py -v`
Expected: FAIL — file does not exist yet, `RLS == ""`, assertions fail.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260819081000_worker_table_rls.sql`:

```sql
-- supabase/migrations/20260819081000_worker_table_rls.sql
-- Closes two review findings on the worker-only tables:
--  (1) The `cache` table (dedupe, spec §3/§5) had no migration — it was only
--      ever created by db.init_tables() in tests, so a fresh Supabase DB +
--      the worker's cache lookup (cache.py, reached for any job_url) failed
--      with `relation "cache" does not exist`. Create it here.
--  (2) The worker-only tables sat in `public` with RLS OFF. service_role and
--      the worker's direct DATABASE_URL owner connection BYPASS RLS, so
--      enabling it does not affect the worker; it only closes the default
--      public grants that expose these rows (full InvestigationState in
--      checkpoints.checkpoint) to anon/authenticated via PostgREST.
-- OPERATOR: apply after 20260819073430_langgraph_checkpointer.sql. Not run by
-- the implementation. Verified by scripts/verify_rls.sql.

-- (1) Dedupe cache — columns mirror app/cache.py (key, value, expires_at).
create table if not exists cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);

-- (2) Deny-all RLS (RLS enabled, zero policies) on every worker-only table.
-- No `create policy` anywhere: authenticated/anon get zero rows; the worker,
-- connecting as owner/service_role, is unaffected.
alter table cache enable row level security;
alter table checkpoints enable row level security;
alter table checkpoint_blobs enable row level security;
alter table checkpoint_writes enable row level security;
alter table checkpoint_migrations enable row level security;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/migrations/test_worker_table_rls.py -v`
Expected: PASS (all three tests).

### Task 1.2: Shape sources before writing them to the cache

**Files:**
- Modify: `apps/api/src/app/worker/functions.py:59-64`
- Test: `apps/api/tests/worker/test_functions.py`

Closes **Minor #5**: `put_cached_report` currently serializes `state.sources` raw/undefanged. Defense-in-depth — even with #2 fixed, the cache should never hold an un-shaped raw excerpt. Reuse `persistence.shape()`.

**Interfaces:**
- Consumes: `shape(sources, findings, assessment, what_to_verify)` from `app.worker.persistence` (returns the same 4-tuple, shaped).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/worker/test_functions.py` (mirror the FakePool + fake-cache idiom already used in that file; capture what `put_cached_report` is handed):

```python
import uuid
import pytest
from app.graph.state import Source, FinalAssessment
from datetime import datetime, timezone


async def test_cache_write_is_shaped_and_defanged(monkeypatch):
    from app.worker import functions
    captured = {}

    async def fake_put(key, value, **kw):
        captured["value"] = value

    monkeypatch.setattr(functions.cache, "put_cached_report", fake_put)
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")
    monkeypatch.setattr(functions.cache, "get_cached_report", lambda k: _none())

    src = Source(id="s1", url="http://evil.example/x", kind="fetched_page",
                 retrieved_at=datetime.now(timezone.utc), content_summary="c",
                 raw_excerpt="see http://evil.example " + "A" * 1000)

    class FakePersistence:
        async def get_submission(self, i): 
            from app.graph.state import RawSubmission
            return RawSubmission(job_text="x", job_url="http://co.example"), "queued"
        async def set_status(self, *a): pass
        async def persist_result(self, *a, **k): pass

    async def fake_run(inv, sub, p):
        from app.graph.state import InvestigationState  # returned state carries raw src
        state = _state_with(sources=[src])
        return state, "done"

    await functions.handle_requested(uuid.uuid4(), persistence=FakePersistence(), run=fake_run)

    blob = str(captured["value"])
    assert "http://" not in blob          # url + raw_excerpt defanged before cache
    # excerpt capped
    assert all(len(s.get("raw_excerpt", "")) <= 500 for s in captured["value"]["sources"])
```

> Helpers `_none()`, `_state_with(...)` follow the existing construction pattern in `test_functions.py` (build an `InvestigationState` with the given sources, empty findings, `assessment=None`, empty `cost_events`/`deterministic_signals`). If the file already has a state builder, reuse it verbatim rather than re-deriving.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/worker/test_functions.py::test_cache_write_is_shaped_and_defanged -v`
Expected: FAIL — cached blob still contains `http://` (raw url/excerpt), excerpt > 500.

- [ ] **Step 3: Implement — shape before caching**

In `apps/api/src/app/worker/functions.py`, add the import and shape the sources on the cache-write path:

```python
from app.worker.persistence import Persistence, shape
```

Replace the cache-write block (currently lines 59-64):

```python
    if key and status == "done":
        shaped_sources, shaped_findings, shaped_assessment, shaped_what = shape(
            state.sources, state.findings, state.assessment, what)
        await cache.put_cached_report(key, {
            "assessment": shaped_assessment.model_dump(mode="json") if shaped_assessment else None,
            "findings": [f.model_dump(mode="json") for f in shaped_findings],
            "sources": [s.model_dump(mode="json") for s in shaped_sources],
            "cost": cost, "what_to_verify": shaped_what})
    return status
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/worker/test_functions.py -v`
Expected: PASS. Then run the whole worker suite (`uv run pytest tests/worker tests/graph -q`) to confirm no regressions in the cache-hit path (`persist_result` still re-shapes on read, so the hit path is unchanged).

### Task 1.3: Extend `verify_rls.sql` — cache + checkpointer non-exposure

**Files:**
- Modify: `scripts/verify_rls.sql` (add a case before the final `rollback;`)
- Test: `apps/api/tests/migrations/test_worker_table_rls.py` (extend)

`verify_rls.sql` is the operator's runtime backstop (`FakePool` can't execute SQL). Add a case that, as `authenticated`, expects **0 rows** from `cache` and `checkpoints`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/migrations/test_worker_table_rls.py`:

```python
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()

def test_verify_rls_asserts_worker_table_non_exposure():
    # A new case must reference cache + checkpoints under the authenticated role.
    assert "cache" in VERIFY
    assert "checkpoints" in VERIFY
    assert "case 8" in VERIFY  # the new block
```

> `MIGRATIONS` is `.../supabase/migrations`; `MIGRATIONS.parents[1]` is the repo root, so `scripts/verify_rls.sql` resolves. Adjust the index if the earlier `MIGRATIONS` definition changes.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/migrations/test_worker_table_rls.py::test_verify_rls_asserts_worker_table_non_exposure -v`
Expected: FAIL — no `case 8` in the script yet.

- [ ] **Step 3: Implement — add Case 8**

In `scripts/verify_rls.sql`, immediately before the final `rollback;`, add:

```sql
-- -----------------------------------------------------------------------
-- Case 8: worker-only tables are not client-readable. As `authenticated`,
-- `cache` and `checkpoints` must return 0 rows (deny-all RLS), even though
-- the worker (service_role / owner) reads them freely. Seed one row of each
-- as the bypassing role first.
-- -----------------------------------------------------------------------
do $$
declare
  v_cache int;
  v_ckpt int;
begin
  reset role;  -- service_role / owner bypasses RLS for setup
  insert into cache (key, value, expires_at)
    values ('verify-key', '{"x":1}'::jsonb, now() + interval '1 hour')
    on conflict (key) do nothing;
  insert into checkpoints (thread_id, checkpoint_id, checkpoint)
    values ('verify-thread', 'verify-ckpt', '{"x":1}'::jsonb)
    on conflict do nothing;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  select count(*) into v_cache from cache;
  select count(*) into v_ckpt from checkpoints;

  if v_cache <> 0 then
    raise exception 'CASE 8 FAILED: authenticated read % cache rows (expected 0)', v_cache;
  end if;
  if v_ckpt <> 0 then
    raise exception 'CASE 8 FAILED: authenticated read % checkpoints rows (expected 0)', v_ckpt;
  end if;

  raise notice 'CASE 8 OK: cache + checkpoints deny-all to authenticated';
end $$;

reset role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/migrations/ -v`
Expected: PASS. (Operator runs `verify_rls.sql` itself against the local stack per RUNBOOK — do NOT run it here.)

---

## Phase 2 — Run-start tracking, honest zombie detection, atomic terminal write

Closes backend review **Important #3** (zombie sweep keys off `created_at`, can fail a legitimately-running re-emitted row mid-run) and **Important #4** (non-atomic `persist_result` + `set_status` can strand a row with results but status `running`).

### Task 2.1: Add `investigations.started_at` and stamp it on `running`

**Files:**
- Create: `supabase/migrations/20260819082000_investigations_started_at.sql`
- Modify: `apps/api/src/app/worker/persistence.py:82-85` (`set_status`)
- Test: `apps/api/tests/migrations/test_worker_table_rls.py` (extend), `apps/api/tests/worker/test_persistence.py`

**Interfaces:**
- Produces: `investigations.started_at timestamptz` (nullable, worker-set); `Persistence.set_status(inv_id, status)` stamps `started_at = now()` when `status == "running"`.

- [ ] **Step 1: Write the failing tests**

Migration static check — add to `test_worker_table_rls.py`:

```python
STARTED = (MIGRATIONS / "20260819082000_investigations_started_at.sql").read_text().lower() \
    if (MIGRATIONS / "20260819082000_investigations_started_at.sql").exists() else ""

def test_started_at_column_added_and_nulled_in_defaults_trigger():
    assert "add column if not exists started_at timestamptz" in STARTED
    assert "new.started_at := null" in STARTED  # client can't seed it
```

Behavior check — add to `test_persistence.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/migrations tests/worker/test_persistence.py -k "started_at" -v`
Expected: FAIL — migration missing; `set_status` issues a single unconditional UPDATE with no `started_at`.

- [ ] **Step 3: Implement**

Create `supabase/migrations/20260819082000_investigations_started_at.sql`:

```sql
-- supabase/migrations/20260819082000_investigations_started_at.sql
-- Adds a real run-start timestamp so zombie detection measures the hard
-- deadline from when the worker actually began running (set_status 'running'),
-- not from row creation. Without it, a re-emitted stale-queued row that
-- legitimately starts running is already past the created_at window and the
-- next sweep fails it mid-run (review Important #3).
-- Worker-set only; the insert-defaults trigger nulls any client-supplied value.
-- OPERATOR: apply after 20260819080000_investigations_sources.sql.

alter table investigations add column if not exists started_at timestamptz;

-- Re-assert the full insert-defaults trigger body (last defined in
-- 20260819080000) with started_at nulled too, so a client cannot seed it.
create or replace function force_investigation_defaults()
returns trigger language plpgsql as $$
begin
  new.status := 'queued';
  new.check_count := null;
  new.assessment := null;
  new.findings := null;
  new.sources := null;
  new.cost := null;
  new.what_to_verify := null;
  new.started_at := null;
  return new;
end $$;
```

In `apps/api/src/app/worker/persistence.py`, replace `set_status`:

```python
    async def set_status(self, inv_id, status) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            if status == "running":
                # Stamp the real run-start so zombie_running measures the hard
                # deadline from here, not from created_at (review Important #3).
                await c.execute(
                    "UPDATE investigations SET status=%s, started_at=now() WHERE id=%s",
                    (status, inv_id))
            else:
                await c.execute(
                    "UPDATE investigations SET status=%s WHERE id=%s", (status, inv_id))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/migrations tests/worker/test_persistence.py -v`
Expected: PASS.

### Task 2.2: Rebase `zombie_running` on `started_at`

**Files:**
- Modify: `apps/api/src/app/worker/persistence.py:120-132` (`zombie_running`)
- Test: `apps/api/tests/worker/test_persistence.py`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/worker/test_persistence.py::test_zombie_running_measures_from_started_at_not_created_at -v`
Expected: FAIL — current query filters on `created_at`.

- [ ] **Step 3: Implement**

Replace the query in `zombie_running`:

```python
            cur = await c.execute(
                "SELECT id FROM investigations WHERE status='running' "
                "AND started_at IS NOT NULL "
                "AND started_at < now() - (%s || ' seconds')::interval",
                (settings.zombie_running_threshold_s,))
```

Update the docstring to say the window is measured from `started_at` (the worker's run-start), and note that a `running` row with a NULL `started_at` is never swept (it can only occur if the run never passed through `set_status('running')`, which the normal path guarantees). `stale_queued` is unchanged (queued rows have no run-start; `created_at` is correct there).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/worker/test_persistence.py -v`
Expected: PASS.

### Task 2.3: Atomic terminal write (`persist_result` writes status in one UPDATE)

**Files:**
- Modify: `apps/api/src/app/worker/persistence.py:94-105` (`persist_result`)
- Modify: `apps/api/src/app/worker/functions.py:39-44, 56-58`
- Test: `apps/api/tests/worker/test_persistence.py`, `apps/api/tests/worker/test_functions.py`

**Interfaces:**
- Produces: `persist_result(..., status: str | None = None)`. When `status` is given, results **and** status land in a single UPDATE on one connection. Callers drop the separate `set_status` on the terminal path.

- [ ] **Step 1: Write the failing tests**

Persistence — one atomic statement:

```python
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
```

Functions — no separate terminal `set_status`:

```python
async def test_handle_requested_terminal_write_is_atomic(monkeypatch):
    from app.worker import functions
    calls = []

    class RecordingPersistence:
        async def get_submission(self, i):
            from app.graph.state import RawSubmission
            return RawSubmission(job_text="x"), "queued"   # no job_url -> no cache
        async def set_status(self, inv, status): calls.append(("set_status", status))
        async def persist_result(self, inv, **k): calls.append(("persist_result", k.get("status")))

    async def fake_run(inv, sub, p):
        return _state_with(sources=[]), "done"

    await functions.handle_requested(uuid.uuid4(), persistence=RecordingPersistence(), run=fake_run)

    # 'running' set_status still happens; the TERMINAL write is a single
    # persist_result(status='done'), NOT persist_result + set_status('done').
    assert ("persist_result", "done") in calls
    assert ("set_status", "done") not in calls
    assert calls.count(("set_status", "running")) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/worker -k "atomic" -v`
Expected: FAIL — `persist_result` has no `status` param; `functions.handle_requested` still calls `set_status(status)` after `persist_result`.

- [ ] **Step 3: Implement**

In `persistence.py`, add the `status` param and fold it into the UPDATE:

```python
    async def persist_result(self, inv_id, *, assessment, findings, sources, cost,
                             what_to_verify, check_count=None, status=None) -> None:
        sources, findings, assessment, what_to_verify = shape(sources, findings, assessment, what_to_verify)
        pool = await db.get_pool()
        args = [
            json.dumps(assessment.model_dump(mode="json")) if assessment else None,
            json.dumps([f.model_dump(mode="json") for f in findings]),
            json.dumps([s.model_dump(mode="json") for s in sources]),
            json.dumps(cost), json.dumps(what_to_verify), check_count,
        ]
        set_cols = ("assessment=%s, findings=%s, sources=%s, cost=%s, "
                    "what_to_verify=%s, check_count=%s")
        if status is not None:
            set_cols += ", status=%s"
            args.append(status)
        args.append(inv_id)
        async with pool.connection() as c:
            await c.execute(f"UPDATE investigations SET {set_cols} WHERE id=%s", tuple(args))
```

In `functions.py` `handle_requested`, make both terminal writes atomic:

- Cache-hit path (currently lines 39-44) — fold status in, drop the separate `set_status`:

```python
            await persistence.persist_result(
                inv_id, assessment=_a(cached), findings=_f(cached), sources=_s(cached),
                cost=cached.get("cost", {}), what_to_verify=cached.get("what_to_verify", []),
                check_count=n, status="done")   # atomic; cache-hit writes NO steps (spec §5)
            return "done"
```

- Run path (currently lines 56-58) — fold status in, drop the separate `set_status`:

```python
    await persistence.persist_result(inv_id, assessment=state.assessment, findings=state.findings,
                                     sources=state.sources, cost=cost, what_to_verify=what,
                                     status=status)   # atomic 'done' | 'deadline_exceeded'
```

- [ ] **Step 4 (optional, Minor #6): set `check_count` on the originating run**

If cheap, pass `check_count=1` on the run path's `persist_result` so the first dedupe hit reads `2` instead of jumping from NULL→2. Skip if it complicates the atomic UPDATE or existing assertions — cosmetic only.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/worker tests/graph -q`
Expected: PASS. Update any existing `test_functions.py` assertion that expected a trailing `set_status(terminal)` — the terminal status now rides inside `persist_result`. Confirm the `deadline_exceeded` branch still records status via `persist_result(status="deadline_exceeded")`.

---

## Phase 3 — Web: sign-in redirect + honest incomplete report

Closes web review **Important #1** (authenticated users land back on the sign-in form) and **Important #2** (`done`/`deadline_exceeded` with a null assessment fabricates a `MODERATE` band + empty summary).

### Task 3.1: `/sign-in` redirects an authenticated visitor to `/verify`

**Files:**
- Modify: `apps/web/app/sign-in/page.tsx`
- Test: `apps/web/app/sign-in/__tests__/page.test.tsx` (create)

The page is currently `"use client"`. Convert the page shell to a server component that checks the session and `redirect("/verify")` when present; keep `AuthForm`/`SiteHeader` (client) as children. `middleware.ts` guards `/verify` + `/investigations/*` but not `/sign-in`, so this closes the loop where the header CTA funnels a signed-in user back to the form.

**Interfaces:**
- Consumes: `createClient()` from `apps/web/lib/supabase/server.ts` → `supabase.auth.getUser()`; `redirect` from `next/navigation`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/sign-in/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import Page from "../page";

describe("/sign-in", () => {
  beforeEach(() => { getUser.mockReset(); redirect.mockClear(); });

  it("redirects an authenticated visitor to /verify", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.co" } } });
    await expect(Page()).rejects.toThrow("REDIRECT:/verify");
    expect(redirect).toHaveBeenCalledWith("/verify");
  });

  it("renders the sign-in form for an anonymous visitor", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const el = await Page();           // returns JSX, does not redirect
    expect(el).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm test -- sign-in`
Expected: FAIL — current default export is a sync client component; `Page()` doesn't call `getUser`/`redirect`.

- [ ] **Step 3: Implement — server component with a session guard**

Rewrite `apps/web/app/sign-in/page.tsx` (drop `"use client"`; make it `async`):

```tsx
// The auth gate between pasting a posting and running the check. Server
// component: an already-authenticated visitor is bounced to /verify so the
// header "Check a job" CTA never dead-ends a signed-in user on the sign-in
// form (middleware guards /verify + /investigations/*, not /sign-in).
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { SiteHeader } from "../../components/site/SiteHeader";
import { MicroLabel } from "../../components/ui/MicroLabel";
import { AuthForm } from "../../components/auth/AuthForm";
import { QueuedCard } from "../../components/auth/QueuedCard";

export default async function Page() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/verify");

  return (
    <>
      <SiteHeader />
      <main
        id="main-content"
        className="mx-auto grid max-w-page grid-cols-1 gap-10 px-8 py-16 md:grid-cols-[1fr_420px]"
      >
        <div className="flex flex-col gap-6">
          <MicroLabel>STEP 2 OF 3 · SIGN IN REQUIRED</MicroLabel>
          <h1 className="m-0 text-[48px] font-bold leading-[0.98] tracking-[-0.03em]">
            SIGN IN TO RUN
            <br />
            THIS CHECK
          </h1>
          <p className="max-w-[520px] text-[16px] leading-[1.6] text-secondary">
            Reports name companies and people, so they don&apos;t sit on a public page. Signing
            in keeps yours to you and lets us hold the report if you close the tab mid-check.
          </p>
          <QueuedCard />
        </div>
        <AuthForm />
      </main>
    </>
  );
}
```

> Copy is verbatim from the current page (design tokens FINAL). Only the server guard is new.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test -- sign-in && npx tsc --noEmit`
Expected: PASS + clean type-check.

### Task 3.2: Null assessment → honest "couldn't complete" state (no fabricated band)

**Files:**
- Modify: `apps/web/lib/report-view-model.ts:135-204`
- Modify: `apps/web/components/investigation/InvestigationView.tsx:77-112`
- Test: `apps/web/lib/__tests__/report-view-model.test.ts`, `apps/web/components/investigation/__tests__/InvestigationView.test.tsx`

`toReportViewModel` currently defaults `band → "MODERATE"`, `confidence → "MODERATE"`, `summary → ""` when `inv.assessment` is null — inventing a risk verdict never computed (worst for `deadline_exceeded`, spec §6 best-effort). Make band/confidence/summary **nullable**, add `complete: boolean`, and render a dedicated incomplete panel that still shows any partial findings + verify items but no band.

**Interfaces:**
- Produces on `ReportVM`: `complete: boolean`; `band: Band | null`, `bandIndex: number | null`, `bandMeaning: string | null`, `confidence: ConfidenceLevel | null`, `confidenceSegments: number | null`, `confidenceNote: string | null`, `summary: string | null`. `groups`, `verifyChecklist`, `caseId`, `repeatLine`, `submitted` are unchanged and always present.
- Consumed only in `InvestigationView.tsx` (`toReportViewModel` has one caller); the report components (`BandBanner`, `ConfidencePanel`, `Summary`) render only on the `complete` branch, so they never receive the nullable-null values.

- [ ] **Step 1: Write the failing tests**

View-model — add to `apps/web/lib/__tests__/report-view-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toReportViewModel } from "../report-view-model";

function inv(overrides: any) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    status: "deadline_exceeded",
    submission: {},
    assessment: null,
    findings: [],
    sources: [],
    what_to_verify: [],
    check_count: null,
    ...overrides,
  } as any;
}

describe("toReportViewModel with a missing assessment", () => {
  it("does not fabricate a band", () => {
    const vm = toReportViewModel(inv({ assessment: null }));
    expect(vm.complete).toBe(false);
    expect(vm.band).toBeNull();
    expect(vm.confidence).toBeNull();
    expect(vm.summary).toBeNull();
  });

  it("stays complete when the assessment is present", () => {
    const vm = toReportViewModel(
      inv({ status: "done", assessment: { band: "LOW", confidence: "HIGH", summary: "ok" } }),
    );
    expect(vm.complete).toBe(true);
    expect(vm.band).toBe("LOW");
  });
});
```

Component — add to `InvestigationView.test.tsx` (mock `useInvestigationLive` to return a terminal investigation with a null assessment):

```tsx
it("shows a couldn't-complete panel, never a MODERATE band, when assessment is null", () => {
  // useInvestigationLive returns { investigation: {status:'deadline_exceeded', assessment:null,...}, steps:[] }
  render(<InvestigationView initial={initialWith({ status: "deadline_exceeded", assessment: null })} />);
  expect(screen.getByText(/couldn.t complete/i)).toBeInTheDocument();
  expect(screen.queryByText(/MODERATE/i)).not.toBeInTheDocument();
});
```

> Reuse the file's existing `useInvestigationLive` mock + `initialWith` helper; if none exists, mock `../../lib/investigations-live` so `useInvestigationLive` returns the provided `initial` verbatim.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npm test -- report-view-model InvestigationView`
Expected: FAIL — `vm.band` is `"MODERATE"`, `vm.complete` undefined; the report renders a `MODERATE` BandBanner.

- [ ] **Step 3: Implement the view-model change**

In `apps/web/lib/report-view-model.ts`:

1. Widen the interface fields to nullable and add `complete`:

```ts
export interface ReportVM {
  caseId: string;
  complete: boolean;              // false when the assessment never computed
  band: Band | null;
  bandIndex: number | null;
  bandMeaning: string | null;
  confidence: ConfidenceLevel | null;
  confidenceSegments: number | null;
  confidenceNote: string | null;
  summary: string | null;
  repeatLine: string;
  submitted: { label: string; value: string; mono?: boolean }[];
  groups: { key: "legitimizing" | "suspicious" | "unverifiable"; heading: string; countMono: string; findings: FindingVM[]; }[];
  verifyChecklist: string[];
}
```

2. Replace the top of `toReportViewModel` (lines 135-139 + the return) so band fields are computed only when the assessment exists:

```ts
export function toReportViewModel(inv: Investigation): ReportVM {
  const assessment = inv.assessment;
  const complete = assessment != null;

  const band: Band | null = assessment?.band ?? null;
  const confidenceRaw = assessment?.confidence ?? null;
  const conf = confidenceRaw ? CONFIDENCE_MAP[confidenceRaw] : null;
  const bandIndex = band ? BAND_INDEX[band] : null;
  const bandMeaning = band ? BAND_MEANING[band] : null;
  // ... (sources/findings/groups/repeatLine/submittedRows unchanged) ...

  return {
    caseId: toCaseId(inv.id),
    complete,
    band,
    bandIndex,
    bandMeaning,
    confidence: conf?.level ?? null,
    confidenceSegments: conf?.segments ?? null,
    confidenceNote: conf ? CONFIDENCE_NOTE[conf.level] : null,
    summary: assessment?.summary ?? null,
    repeatLine,
    submitted: submittedRows,
    groups,
    verifyChecklist: inv.what_to_verify ?? [],
  };
}
```

- [ ] **Step 4: Implement the incomplete render in `InvestigationView.tsx`**

Add an `IncompleteReport` panel and branch to it from `Report` (or from the status switch). It shows a neutral banner + any partial findings + verify items — no band, no confidence:

```tsx
function IncompleteReport({ investigation }: { investigation: Investigation }) {
  const vm = toReportViewModel(investigation);
  return (
    <main id="main-content" className="mx-auto max-w-page px-6 py-16">
      <MicroLabel>COULDN&apos;T COMPLETE THE ASSESSMENT</MicroLabel>
      <p className="mt-2 max-w-[36rem] text-[16px] leading-[1.6]">
        We ran out of time before we could finish weighing this posting, so there&apos;s no
        overall read. Here&apos;s what we did gather — treat it as partial.
      </p>
      <div className="mt-10 flex flex-col gap-10">
        {vm.groups.map((group) => (
          <FindingGroup key={group.key} group={group} />
        ))}
        <VerifyChecklist items={vm.verifyChecklist} />
      </div>
    </main>
  );
}

function Report({ investigation }: { investigation: Investigation }) {
  const vm = toReportViewModel(investigation);
  if (!vm.complete) return <IncompleteReport investigation={investigation} />;
  // ... existing complete-report body unchanged (BandBanner/ConfidencePanel/Summary/...) ...
}
```

Because the complete-report body is only reached when `vm.complete`, TypeScript still needs the nullable fields narrowed. Either (a) narrow with a local assertion after the guard, or (b) build a `CompleteReportVM` view by asserting `vm.band!` etc. at the single call site. Prefer (a): after `if (!vm.complete) return ...`, the band fields are still typed nullable, so pass them through a small `asComplete(vm)` helper that asserts non-null and returns the narrowed type — keep it local to this file. Run `npx tsc --noEmit` to confirm no null leaks into `BandBanner`/`ConfidencePanel`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npm test && npx tsc --noEmit`
Expected: PASS + clean type-check. Confirm the existing "done with assessment" report tests still pass (complete path unchanged).

---

## Phase 4 — Web Realtime robustness + header polish (fast-follow)

Closes web review Minors: **#3** (SELECT→subscribe race), **#4** (non-monotonic reducers), **#5** (`getUser()` per mount), and documents **#7** (cache-hit empty checklist). Lower priority than Phases 1–3; land it as fast-follow if triaged in.

### Task 4.1: One-shot re-SELECT immediately after `.subscribe()`

**Files:**
- Modify: `apps/web/lib/investigations-live.ts:69-72`
- Test: `apps/web/lib/__tests__/investigations-live.test.ts`

Step transitions that land between the SSR SELECT and the client subscription are currently lost until the next event for that step or the terminal re-SELECT. Trigger `reselect()` on the `SUBSCRIBED` status so the client re-reads once the channel is live, closing the gap.

- [ ] **Step 1: Write the failing test**

```ts
it("re-selects once the channel reports SUBSCRIBED", async () => {
  // getInvestigation mock returns a fresh row; subscribe() invokes its callback with "SUBSCRIBED".
  // Assert getInvestigation was called after subscribe (i.e. the post-subscribe reselect fired).
  expect(getInvestigation).toHaveBeenCalledTimes(1);
});
```

> Extend the file's existing supabase-channel mock so the `.subscribe(cb)` mock calls `cb("SUBSCRIBED")`. Assert `getInvestigation` (mocked) is invoked as a result.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm test -- investigations-live`
Expected: FAIL — `reselect` runs only on terminal + CHANNEL_ERROR/TIMED_OUT, not on SUBSCRIBED.

- [ ] **Step 3: Implement**

In the `.subscribe` callback:

```ts
      .subscribe((status) => {
        // Close the SELECT→subscribe gap: re-read once the channel is live so
        // any step transition during subscription setup is not lost (review Minor #3).
        if (status === "SUBSCRIBED") void reselect();
        // CHANNEL_ERROR / TIMED_OUT → degrade to a one-shot re-SELECT (spec §7.5).
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") void reselect();
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npm test -- investigations-live`
Expected: PASS.

### Task 4.2: Make `applyStepEvent` monotonic

**Files:**
- Modify: `apps/web/lib/investigations-live.ts:12-20`
- Test: `apps/web/lib/__tests__/investigations-live.test.ts`

An out-of-order Realtime event could regress a `done` step to `running`. Guard the upsert with a status rank so a lower-rank incoming status never overwrites a higher-rank existing one for the same `step_key`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyStepEvent } from "../investigations-live";

it("does not regress a done step back to running", () => {
  const done = [{ step_key: "intake", display_order: 1, status: "done" }] as any;
  const stale = { step_key: "intake", display_order: 1, status: "running" } as any;
  const next = applyStepEvent(done, stale);
  expect(next.find((s) => s.step_key === "intake")!.status).toBe("done");
});

it("still advances pending → running → done", () => {
  let steps = [{ step_key: "intake", display_order: 1, status: "pending" }] as any;
  steps = applyStepEvent(steps, { step_key: "intake", display_order: 1, status: "running" } as any);
  steps = applyStepEvent(steps, { step_key: "intake", display_order: 1, status: "done" } as any);
  expect(steps[0].status).toBe("done");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm test -- investigations-live`
Expected: FAIL — the current reducer blindly replaces the row, so `done` regresses to `running`.

- [ ] **Step 3: Implement**

```ts
const STEP_RANK: Record<string, number> = {
  pending: 0, running: 1, skipped: 2, failed: 3, done: 3,
};

export function applyStepEvent(
  steps: InvestigationStep[],
  row: InvestigationStep,
): InvestigationStep[] {
  const existing = steps.find((s) => s.step_key === row.step_key);
  // Monotonic: never regress to a lower-rank status for the same step
  // (out-of-order Realtime delivery — review Minor #4).
  if (existing && STEP_RANK[row.status] < STEP_RANK[existing.status]) {
    return steps;
  }
  const next = steps.filter((s) => s.step_key !== row.step_key);
  next.push(row);
  next.sort((a, b) => a.display_order - b.display_order);
  return next;
}
```

> `failed` and `done` share rank 3 (both terminal): a terminal status won't be overwritten by the other, matching "a step ends once." Confirm the step-status union in `investigations.ts` matches these keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npm test -- investigations-live`
Expected: PASS.

### Task 4.3: `SiteHeader` uses `getSession()` (no Auth round-trip, no flash)

**Files:**
- Modify: `apps/web/components/site/SiteHeader.tsx:16-25`
- Test: `apps/web/components/site/__tests__/SiteHeader.test.tsx`

`getUser()` hits the Auth server on every mount and flashes "Sign in" before it resolves. `getSession()` reads the local session synchronously-ish and avoids both.

- [ ] **Step 1: Write/adjust the failing test**

Update the existing SiteHeader test's supabase mock to provide `auth.getSession` returning `{ data: { session: { user: { email } } } }`, and assert the email renders without a `getUser` call:

```tsx
expect(getSession).toHaveBeenCalled();
expect(getUser).not.toHaveBeenCalled();
expect(await screen.findByText("a@b.co")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm test -- SiteHeader`
Expected: FAIL — component calls `getUser`, mock provides `getSession`.

- [ ] **Step 3: Implement**

```tsx
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setEmail(data.session?.user?.email ?? null);
    });
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npm test -- SiteHeader && npx tsc --noEmit`
Expected: PASS + clean type-check.

### Task 4.4: Document the cache-hit empty-checklist contract (Minor #7)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-19-v1-web-supabase-integration-design.md` (§7 data contract)

A cache-hit investigation reaches `done` with **zero** `investigation_steps` rows (worker writes no steps on a hit, spec §5). The web `/investigations/[id]` view must render a `done` report with an empty checklist without erroring. Add one line to the §7 contract making this explicit for the web team.

- [ ] **Step 1:** Add to §7 (data contract / status handling) a sentence: *"A cache-hit investigation is `done` with no `investigation_steps` rows; the report view renders from `assessment`/`findings`/`sources` and must tolerate an empty step list (no checklist)."*
- [ ] **Step 2:** No code test — this is a spec clarification. Confirm `InvestigationView`'s `done` path already renders `Report` (not the checklist) regardless of `steps.length`, so no code change is required; if a checklist assumption exists, open a follow-up.

---

## Self-Review

**Finding coverage:**
- Backend Critical #1 (missing cache) → Task 1.1. ✅
- Backend Important #2 (RLS-off worker tables) → Task 1.1 (+ verify_rls Task 1.3). ✅
- Backend Important #3 (zombie via created_at) → Tasks 2.1 + 2.2. ✅
- Backend Important #4 (non-atomic terminal write) → Task 2.3. ✅
- Backend Minor #5 (unshaped cache) → Task 1.2. ✅
- Backend Minor #6 (check_count) → Task 2.3 Step 4 (optional). ✅
- Backend Minor #8 (verify_rls backstop) → Task 1.3. ✅
- Web Important #1 (sign-in redirect) → Task 3.1. ✅
- Web Important #2 (fabricated MODERATE) → Task 3.2. ✅
- Web Minor #3 (SELECT→subscribe race) → Task 4.1. ✅
- Web Minor #4 (monotonic reducers) → Task 4.2. ✅
- Web Minor #5 (getUser→getSession) → Task 4.3. ✅
- Web Minor #7 (cache-hit empty checklist) → Task 4.4. ✅
- Web Minor #6 (pre-existing token-class assertions) → deferred (documented). ✅

**Type consistency:** `persist_result(..., status=None)` added in Task 2.3 and called with `status=` in `functions.py`; `set_status` still exists for the `'running'` write (Task 2.1). `ReportVM` nullable fields + `complete` added in Task 3.2 and narrowed at the single call site in `InvestigationView`. Migration timestamps sort after existing ones (`081000` > `080000`, `082000` > `081000`).

**Live-DB safety:** No task runs Supabase/psql/inngest. SQL is guarded by static file tests (Tasks 1.1/1.3/2.1) + operator-run `verify_rls.sql`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-19-v1-review-remediation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
