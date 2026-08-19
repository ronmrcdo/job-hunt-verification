# V1 Supabase-First Background Investigations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure investigations to run in a background Inngest worker triggered by a Supabase INSERT, with Supabase owning auth/DB/Realtime and Python reduced to the Inngest workflow service.

**Architecture:** The browser INSERTs an `investigations` row under RLS. An AFTER INSERT trigger invokes the `emit-investigation-requested` Edge Function, which sends `investigation.requested` to Inngest. The Python worker (ASGI, `/api/inngest` + `/healthz` only) runs the existing LangGraph via `astream_events`, upserting `investigation_steps` for live progress and persisting an already-shaped result. LangGraph's Postgres checkpointer (thread id = investigation id) makes Inngest retries resume mid-run.

**Tech Stack:** Supabase (Postgres + Auth + Realtime + Edge Functions/Deno), Inngest (Python SDK on ASGI), LangGraph 1.x + `langgraph-checkpoint-postgres`, psycopg 3 async pool, pytest/pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md` — read it alongside this plan; every task argues from a numbered section (§) of that spec.

## Global Constraints

- **NEVER touch a live database.** Do not run `supabase start`, `supabase db push`, `supabase migration up`, `psql`, or any command that applies migrations or connects to Postgres. Migration files and `scripts/*.sql` are **authored and reviewed only**; the operator (Ron) applies them. (Spec §5 hard constraint.)
- **Python has no user-facing HTTP routes.** The only routes are `POST/PUT /api/inngest` (SDK-managed) and `GET /healthz`. (Spec §6.)
- **The worker is the only writer of `assessment`/`findings`/`sources`, and writes only already-shaped data** — excerpted (`raw_excerpt` ≤ 500 chars), defanged (`defang_text`), capped. Never persist the `raw_sources`/`raw_findings` accumulator channels. (Spec §3, §10.)
- **Idempotency key is the investigation id.** Inngest `event.id = investigation_id`; every step upsert is idempotent so a retry replaying completed nodes rewrites identical terminal rows. (Spec §8.)
- **Job-text cap = `settings.max_job_text_chars` (currently 40 000).** The DB CHECK must match this value. (Spec §4; `apps/api/src/app/config.py`.)
- **Statuses:** investigation `queued → running → done | failed | deadline_exceeded`; step `pending | running | done | skipped | failed`. (Spec §3, §5.)
- **No self-authored commit steps** — the operator commits. Do not add `git commit` to any task.
- Python 3.12; tests run from `apps/api` with `uv run pytest` (pytest `pythonpath=["src"]`, `asyncio_mode=auto`).

---

## File Structure

**Created**
- `supabase/migrations/20260819073420_investigations_v1.sql` — investigations reshape, `investigation_steps`, RLS, CHECK, triggers, realtime publication.
- `supabase/migrations/20260819073430_langgraph_checkpointer.sql` — checkpointer tables (authored, not `setup()`-created).
- `supabase/functions/emit-investigation-requested/index.ts` — Edge Function: webhook → `inngest.send`.
- `supabase/functions/emit-investigation-requested/event.ts` — pure payload→event mapper (unit-tested).
- `supabase/functions/emit-investigation-requested/event.test.ts` — Deno test.
- `apps/api/src/app/graph/steps.py` — `STEP_REGISTRY` (node name → `StepDef`).
- `apps/api/src/app/worker/__init__.py`
- `apps/api/src/app/worker/persistence.py` — the fake-able DB seam: step upserts, shaped result writes, row reads, status.
- `apps/api/src/app/worker/runner.py` — streams the graph via `astream_events`, maps node events → step callbacks, enforces the soft deadline.
- `apps/api/src/app/worker/functions.py` — Inngest functions `run-investigation`, `sweep-stale-queued`.
- `apps/api/src/app/worker/app.py` — ASGI app: Inngest client + `serve`, `GET /healthz`.
- `apps/api/tests/graph/test_steps.py`, `apps/api/tests/worker/test_persistence.py`, `apps/api/tests/worker/test_runner.py`, `apps/api/tests/worker/test_functions.py`, `apps/api/tests/worker/test_app.py`.
- `scripts/verify_rls.sql` + `scripts/RUNBOOK.md` — operator-run RLS/trigger verification.
- `scripts/smoke_e2e.md` — operator-run end-to-end smoke (sign-in → insert → Realtime → select).

**Modified**
- `apps/api/pyproject.toml` — add `inngest` dependency.
- `apps/api/src/app/graph/build.py` — expose `build_graph`/checkpointer helpers to the streaming runner (keep one clean version; the runner reuses `build_graph`).
- `apps/api/src/app/db.py` — drop `init_tables()` and `owner_key`-shaped SQL; keep the pool.

**Deleted (Phase 6)**
- `apps/api/src/app/main.py` route layer, `_require_owner_key`, `_run_with_deadline`, `_RESULTS`, `_persist`, `load_result`, `_excerpt_sources`.
- `apps/api/scripts/dump_openapi.py`, `apps/api/tests/test_openapi_dump.py`.
- `packages/api-types/`, `scripts/gen-types.mjs`, `docker-compose.yml`.

---

## Task 1: Database migrations, RLS & checkpointer schema (authored only)

Implements spec §4, §5, and gap resolutions #1 (publish `investigations`), #3 (checkpointer as migration), #4 (non-null `job_text` CHECK).

**Files:**
- Create: `supabase/migrations/20260819073420_investigations_v1.sql`
- Create: `supabase/migrations/20260819073430_langgraph_checkpointer.sql`
- Create: `scripts/verify_rls.sql`, `scripts/RUNBOOK.md`

**Interfaces:**
- Produces (for later tasks): table `investigations(id uuid pk, user_id uuid not null default auth.uid(), status text not null default 'queued', submission jsonb not null, assessment jsonb, findings jsonb, cost jsonb, what_to_verify jsonb, check_count int, created_at timestamptz default now())`; table `investigation_steps(investigation_id uuid, step_key text, label text, display_order int, status text, started_at timestamptz, finished_at timestamptz, primary key (investigation_id, step_key))`. Both in `supabase_realtime`. Edge Function name referenced by the trigger: `emit-investigation-requested` (Task 2).

> **TDD note for this task:** the Global Constraint forbids running a database, so the red/green gate here is the **operator-run** `scripts/verify_rls.sql`. Author each assertion in that script as the "expected behavior" (the red step) *before* writing the migration that satisfies it (the green step). The executor writes both files but does **not** run them; the runbook tells the operator how.

- [ ] **Step 1: Write the operator verification script (the expected behavior)**

Create `scripts/verify_rls.sql` asserting, as user A vs user B (via `set local role authenticated; set local request.jwt.claims ...`), the spec §10 checklist:

```sql
-- scripts/verify_rls.sql — operator-run only (NOT run by implementation).
-- Run inside a transaction that is rolled back. Each block RAISEs on failure.

-- 1. A can insert its own row; status is forced to 'queued' regardless of input.
-- 2. A can select its own row; A canNOT select B's row (0 rows, not error).
-- 3. A canNOT update status or any server column (policy denies UPDATE).
-- 4. Oversize job_text (> 40000 chars) INSERT is rejected by CHECK.
-- 5. Missing job_text ({} submission) INSERT is rejected by CHECK  <-- gap #4.
-- 6. AFTER INSERT fires the webhook (assert a net._http_response row / trigger side effect).
```

Write real `DO $$ ... $$` blocks with `RAISE EXCEPTION` on the wrong outcome for cases 1–5 (case 6 is observed via the Edge Function log, documented in the runbook). Include the exact JWT-claims `set_config` calls for two fake user UUIDs.

- [ ] **Step 2: Write `20260819073420_investigations_v1.sql`**

```sql
-- supabase/migrations/20260819073420_investigations_v1.sql

alter table investigations drop column if exists owner_key;
alter table investigations add column user_id uuid not null default auth.uid()
  references auth.users(id);
alter table investigations alter column status set default 'queued';
alter table investigations add column if not exists check_count int;

alter table investigations add constraint investigations_status_chk
  check (status in ('queued','running','done','failed','deadline_exceeded'));

-- gap #4: presence AND length — a NULL char_length passes a CHECK, so assert the key exists.
alter table investigations add constraint investigations_job_text_chk
  check (
    submission ? 'job_text'
    and char_length(submission->>'job_text') between 1 and 40000
  );

create table investigation_steps (
  investigation_id uuid not null references investigations(id) on delete cascade,
  step_key text not null,
  label text not null,
  display_order int not null,
  status text not null default 'pending'
    check (status in ('pending','running','done','skipped','failed')),
  started_at timestamptz,
  finished_at timestamptz,
  primary key (investigation_id, step_key)
);

alter table investigations enable row level security;
alter table investigation_steps enable row level security;

create policy investigations_insert_own on investigations
  for insert to authenticated with check (user_id = auth.uid());
create policy investigations_select_own on investigations
  for select to authenticated using (user_id = auth.uid());
-- no update/delete policies => client cannot mutate.

create policy steps_select_own on investigation_steps
  for select to authenticated using (
    exists (select 1 from investigations i
            where i.id = investigation_steps.investigation_id
              and i.user_id = auth.uid())
  );
-- no client write policies on investigation_steps.

-- Force server-set columns regardless of client input (spec §4).
create or replace function force_investigation_defaults()
returns trigger language plpgsql as $$
begin
  new.status := 'queued';
  new.check_count := null;
  new.assessment := null;
  new.findings := null;
  new.cost := null;
  new.what_to_verify := null;
  return new;
end $$;
create trigger trg_force_defaults before insert on investigations
  for each row execute function force_investigation_defaults();

-- gap #1: publish BOTH tables so the client can subscribe to the status flip.
alter publication supabase_realtime add table investigations;
alter publication supabase_realtime add table investigation_steps;
```

- [ ] **Step 3: Write the trigger that invokes the Edge Function**

Append to `20260819073420_investigations_v1.sql` an AFTER INSERT trigger that calls the `emit-investigation-requested` Edge Function via Supabase's own function-invocation mechanism (`supabase_functions.http_request`), so **no Inngest URL/key appears here** (spec §5, gap #2):

```sql
create trigger trg_emit_requested after insert on investigations
  for each row execute function supabase_functions.http_request(
    'emit-investigation-requested',   -- resolved to the project's functions endpoint
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );
```

Add a `-- NOTE:` comment: if the target Supabase version exposes function webhooks under a different helper signature, the operator wires the equivalent Database Webhook to the same function; the migration must never embed the Inngest endpoint.

- [ ] **Step 4: Write `20260819073430_langgraph_checkpointer.sql` (gap #3)**

Author the checkpointer tables so `AsyncPostgresSaver.setup()` becomes a no-op. Add a header comment recording the pinned version and how the DDL was obtained:

```sql
-- supabase/migrations/20260819073430_langgraph_checkpointer.sql
-- Reproduces the schema langgraph-checkpoint-postgres (>=3.1, pinned in
-- apps/api/pyproject.toml) would create via AsyncPostgresSaver.setup().
-- OPERATOR: regenerate by capturing setup() output against a throwaway local
-- DB when bumping the checkpointer version — never hand-edit from memory.
-- Tables: checkpoint_migrations, checkpoints, checkpoint_blobs, checkpoint_writes.
```

Paste the exact `CREATE TABLE` / index statements for that version's four tables (`checkpoint_migrations`, `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`). These are worker-only: do **not** enable RLS or add client policies. Leave a `-- VERIFY:` line instructing the operator to diff against a fresh `setup()` before applying.

- [ ] **Step 5: Write `scripts/RUNBOOK.md`**

Document, for the operator: prerequisites (`supabase start`), applying migrations, running `verify_rls.sql` inside a rolled-back transaction, how to confirm case 6 (Edge Function invocation) via `supabase functions logs`, and the checkpointer-DDL regeneration step. State plainly that the implementation does not run any of this.

- [ ] **Step 6: Self-check (no DB run)**

Re-read spec §4 and §5 against the two migrations. Confirm: `owner_key` dropped; `user_id` defaulted to `auth.uid()`; both tables published; CHECK asserts presence+length with cap 40000; no client UPDATE/DELETE/write policies; checkpointer tables carry no RLS. Fix inline. (No command to run — this is the gate the operator later executes.)

---

## Task 2: `emit-investigation-requested` Edge Function

Implements spec §5 (Edge Function owns the Inngest URL/key), gap #2.

**Files:**
- Create: `supabase/functions/emit-investigation-requested/event.ts`
- Create: `supabase/functions/emit-investigation-requested/event.test.ts`
- Create: `supabase/functions/emit-investigation-requested/index.ts`

**Interfaces:**
- Consumes: Supabase Database Webhook payload shape `{ type: "INSERT", table: "investigations", record: { id: string, ... } }`.
- Produces: an Inngest event body `{ name: "investigation.requested", id: <record.id>, data: { investigation_id: <record.id> } }` POSTed to `${INNGEST_EVENT_URL}/e/${INNGEST_EVENT_KEY}`. Consumed by Task 5's `run-investigation` (event name + `data.investigation_id`).

- [ ] **Step 1: Write the failing test for the pure mapper**

```ts
// supabase/functions/emit-investigation-requested/event.test.ts
import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { buildInngestEvent } from "./event.ts";

Deno.test("maps an INSERT webhook to investigation.requested with id = row id", () => {
  const payload = { type: "INSERT", table: "investigations", record: { id: "abc-123" } };
  const evt = buildInngestEvent(payload);
  assertEquals(evt, {
    name: "investigation.requested",
    id: "abc-123",                       // idempotency key = investigation id
    data: { investigation_id: "abc-123" },
  });
});

Deno.test("throws on a payload with no record id", () => {
  let threw = false;
  try { buildInngestEvent({ type: "INSERT", table: "investigations", record: {} } as never); }
  catch { threw = true; }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `deno test supabase/functions/emit-investigation-requested/event.test.ts`
Expected: FAIL — `buildInngestEvent` not found. (If Deno is unavailable in the executor's environment, note that and write the code to satisfy the asserted shape exactly; the operator runs the Deno test.)

- [ ] **Step 3: Implement the pure mapper**

```ts
// supabase/functions/emit-investigation-requested/event.ts
export interface WebhookPayload { type: string; table: string; record: { id?: string } }
export interface InngestEvent { name: string; id: string; data: { investigation_id: string } }

export function buildInngestEvent(p: WebhookPayload): InngestEvent {
  const id = p.record?.id;
  if (!id) throw new Error("webhook payload missing record.id");
  return { name: "investigation.requested", id, data: { investigation_id: id } };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `deno test supabase/functions/emit-investigation-requested/event.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the serve wrapper (URL/key from env only)**

```ts
// supabase/functions/emit-investigation-requested/index.ts
import { buildInngestEvent, WebhookPayload } from "./event.ts";

Deno.serve(async (req) => {
  const url = Deno.env.get("INNGEST_EVENT_URL");   // per-env: Dev Server local, self-hosted prod
  const key = Deno.env.get("INNGEST_EVENT_KEY");
  if (!url || !key) return new Response("missing inngest config", { status: 500 });

  const payload = (await req.json()) as WebhookPayload;
  const event = buildInngestEvent(payload);

  const res = await fetch(`${url}/e/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  // Non-2xx => let the invocation layer retry; the §6 sweeper is the backstop.
  return new Response(null, { status: res.ok ? 202 : 502 });
});
```

- [ ] **Step 6: Document deployment env**

Add a comment block (or `supabase/functions/emit-investigation-requested/README.md`) listing the required secrets and the `supabase secrets set INNGEST_EVENT_URL=... INNGEST_EVENT_KEY=...` command per environment (spec §9). No secret values in the repo.

---

## Task 3: Step registry + streaming emission

Implements spec §5 (step registry, emission, skipped/failed back-fill, idempotent replay).

**Files:**
- Create: `apps/api/src/app/graph/steps.py`
- Create: `apps/api/src/app/worker/__init__.py`
- Create: `apps/api/src/app/worker/persistence.py` (step-write half; result-write half is Task 4)
- Create: `apps/api/src/app/worker/runner.py`
- Test: `apps/api/tests/graph/test_steps.py`, `apps/api/tests/worker/test_runner.py`

**Interfaces:**
- Produces: `STEP_REGISTRY: dict[str, StepDef]` and `StepDef(step_key: str, label: str, display_order: int)`.
- Produces: `async def run_and_emit(inv_id: uuid.UUID, submission: RawSubmission, steps: StepSink) -> tuple[InvestigationState, str]` in `runner.py`, returning `(final_state, terminal_status)` where status ∈ `{"done","deadline_exceeded"}` on non-exception paths.
- Consumes: `StepSink` protocol — `seed(inv_id, steps)`, `running(inv_id, step_key, at)`, `done(inv_id, step_key, at)`, `backfill(inv_id)`. Task 4's `Persistence` implements it; `test_runner.py` fakes it.
- Consumes: `app.graph.build.build_graph(checkpointer)` (existing), node names `intake/checks/research/analysis/advocate/report`.

- [ ] **Step 1: Write the failing registry test**

```python
# apps/api/tests/graph/test_steps.py
from app.graph.steps import STEP_REGISTRY, StepDef
from app.graph.build import build_graph

def test_registry_covers_user_meaningful_nodes_in_order():
    keys = [s.step_key for s in sorted(STEP_REGISTRY.values(), key=lambda s: s.display_order)]
    assert keys == ["intake", "deterministic_checks", "company_research",
                    "evidence_analysis", "devils_advocate", "report"]

def test_registry_node_names_exist_in_the_compiled_graph():
    graph_nodes = set(build_graph().get_graph().nodes)   # node names wired in build.py
    for node_name in STEP_REGISTRY:
        assert node_name in graph_nodes, f"{node_name} not a real graph node"
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/graph/test_steps.py -v` (from `apps/api`)
Expected: FAIL — `app.graph.steps` does not exist.

- [ ] **Step 3: Implement the registry**

```python
# apps/api/src/app/graph/steps.py
"""Graph node name -> user-facing checklist step (spec §5). Only user-meaningful
nodes appear; internal plumbing (evidence/injection/citation/banding/linter/
crosspost/conversation) emits nothing. Label + order are denormalized onto
investigation_steps rows so the frontend renders purely from data."""
from dataclasses import dataclass

@dataclass(frozen=True)
class StepDef:
    step_key: str
    label: str
    display_order: int

STEP_REGISTRY: dict[str, StepDef] = {
    "intake":   StepDef("intake", "Reading the posting", 1),
    "checks":   StepDef("deterministic_checks", "Running automated checks", 2),
    "research": StepDef("company_research", "Researching the company", 3),
    "analysis": StepDef("evidence_analysis", "Weighing the evidence", 4),
    "advocate": StepDef("devils_advocate", "Challenging the conclusion", 5),
    "report":   StepDef("report", "Writing the report", 6),
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/graph/test_steps.py -v`
Expected: PASS.

- [ ] **Step 5: Write the failing emission test with a fake sink and fake event stream**

```python
# apps/api/tests/worker/test_runner.py
import uuid, pytest
from app.graph.state import RawSubmission, InvestigationState
from app.worker import runner

class FakeSink:
    def __init__(self): self.calls = []
    async def seed(self, inv, steps): self.calls.append(("seed", [s.step_key for s in steps]))
    async def running(self, inv, key, at): self.calls.append(("running", key))
    async def done(self, inv, key, at): self.calls.append(("done", key))
    async def backfill(self, inv): self.calls.append(("backfill",))

async def _events():
    # Minimal astream_events shape: registered + unregistered nodes interleaved.
    yield {"event": "on_chain_start", "name": "intake"}
    yield {"event": "on_chain_end",   "name": "intake"}
    yield {"event": "on_chain_start", "name": "evidence"}   # unregistered -> ignored
    yield {"event": "on_chain_end",   "name": "evidence"}
    yield {"event": "on_chain_start", "name": "report"}
    yield {"event": "on_chain_end",   "name": "report"}

async def test_emits_seed_then_running_done_only_for_registered_nodes(monkeypatch):
    sink = FakeSink()
    monkeypatch.setattr(runner, "_stream_events",
                        lambda graph, state, config: _events())
    monkeypatch.setattr(runner, "_final_state",
                        lambda graph, config: InvestigationState(submission=RawSubmission(job_text="x")))
    state, status = await runner.run_and_emit(uuid.uuid4(), RawSubmission(job_text="x"), sink)
    assert status == "done"
    assert sink.calls[0][0] == "seed"
    assert ("running", "intake") in sink.calls and ("done", "intake") in sink.calls
    assert ("running", "report") in sink.calls
    assert all("evidence" not in c for c in sink.calls)   # unregistered node emits nothing
```

- [ ] **Step 6: Run it, verify it fails**

Run: `uv run pytest tests/worker/test_runner.py -v`
Expected: FAIL — `app.worker.runner` missing.

- [ ] **Step 7: Implement the streaming runner**

```python
# apps/api/src/app/worker/runner.py
"""Runs the compiled graph via astream_events, translating node lifecycle
events into checklist step upserts (spec §5). Enforces the soft deadline
(spec §8): on timeout it returns the best-effort checkpoint state as
'deadline_exceeded' — a clean return, never a raise (gap #5)."""
import asyncio, logging, uuid
from datetime import datetime, timezone
from app.config import settings
from app.graph.build import build_graph
from app.graph.state import InvestigationState, RawSubmission
from app.graph.steps import STEP_REGISTRY

logger = logging.getLogger(__name__)

def _now(): return datetime.now(timezone.utc)

def _stream_events(graph, state, config):
    return graph.astream_events(state, config=config, version="v2")

async def _final_state(graph, config):
    snapshot = await graph.aget_state(config)
    return InvestigationState(**snapshot.values)

async def run_and_emit(inv_id: uuid.UUID, submission: RawSubmission, steps) -> tuple[InvestigationState, str]:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    async with AsyncPostgresSaver.from_conn_string(settings.database_url) as cp:
        await cp.setup()  # no-op: tables authored in the checkpointer migration
        graph = build_graph(checkpointer=cp)
        config = {"configurable": {"thread_id": str(inv_id)}}
        await steps.seed(inv_id, list(STEP_REGISTRY.values()))
        try:
            async def _drive():
                async for ev in _stream_events(graph, InvestigationState(submission=submission), config):
                    reg = STEP_REGISTRY.get(ev.get("name"))
                    if not reg:
                        continue
                    if ev["event"] == "on_chain_start":
                        await steps.running(inv_id, reg.step_key, _now())
                    elif ev["event"] == "on_chain_end":
                        await steps.done(inv_id, reg.step_key, _now())
            await asyncio.wait_for(_drive(), timeout=settings.total_deadline_s)
            return await _final_state(graph, config), "done"
        except asyncio.TimeoutError:
            logger.warning("investigation %s hit soft deadline", inv_id)
            await steps.backfill(inv_id)                      # pending->skipped, running->failed
            return await _final_state(graph, config), "deadline_exceeded"
```

- [ ] **Step 8: Run the runner test, verify it passes**

Run: `uv run pytest tests/worker/test_runner.py -v`
Expected: PASS. If the real `astream_events` event key/version differs from the fake (`name`, `event`), align the fake and the mapper to the actual `langgraph` 1.x shape — do not leave the mapper matching only the fake.

---

## Task 4: Persistence with write-time shaping

Implements spec §3, §5, §10 (worker is the only writer; store only excerpted + defanged + capped data; step upserts idempotent; back-fill).

**Files:**
- Modify: `apps/api/src/app/worker/persistence.py`
- Test: `apps/api/tests/worker/test_persistence.py`

**Interfaces:**
- Produces (implements Task 3's `StepSink` + adds result/row methods on one `Persistence` object bound to `db.get_pool()`):
  - `async def seed(inv_id, steps: list[StepDef]) -> None` — bulk INSERT `pending`, `ON CONFLICT DO NOTHING`.
  - `async def running(inv_id, step_key, at)` / `async def done(inv_id, step_key, at)` — idempotent UPSERT.
  - `async def backfill(inv_id)` — pending→skipped, running→failed.
  - `async def set_status(inv_id, status)`.
  - `async def get_submission(inv_id) -> tuple[RawSubmission, str]` — returns `(submission, status)` for the run.
  - `async def persist_result(inv_id, *, assessment, findings, sources, cost, what_to_verify, check_count=None)` — shapes then writes.
- Produces pure helper `shape(sources, findings, assessment, what_to_verify) -> tuple[...]` — excerpt (≤500) + `defang_text` on source excerpts, finding claims, assessment summary, and each verify item. Consumed by Task 5.

- [ ] **Step 1: Write the failing shaping test (the guardrail)**

```python
# apps/api/tests/worker/test_persistence.py
from datetime import datetime, timezone
from app.graph.state import Source, Finding, FinalAssessment
from app.worker.persistence import shape

def test_shape_excerpts_and_defangs_everything_client_visible():
    src = Source(id="s1", url="http://evil.example/x", kind="fetched_page",
                 retrieved_at=datetime.now(timezone.utc), content_summary="c",
                 raw_excerpt="visit http://evil.example " + "A"*1000)
    find = Finding(id="f1", category="domain", direction="unverifiable", severity="info",
                   claim="see http://evil.example now", source_ids=["s1"], provenance="deterministic")
    assess = FinalAssessment(band="unclear", confidence="low",
                             summary="go to http://evil.example", coverage=0.5)
    sources, findings, assessment, verify = shape([src], [find], assess, ["check http://evil.example"])
    assert len(sources[0].raw_excerpt) <= 500                       # capped
    assert "http://" not in sources[0].raw_excerpt                  # defanged
    assert "http://" not in findings[0].claim
    assert "http://" not in assessment.summary
    assert "http://" not in verify[0]
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/worker/test_persistence.py::test_shape_excerpts_and_defangs_everything_client_visible -v`
Expected: FAIL — `shape` not found.

- [ ] **Step 3: Implement `shape`**

```python
# apps/api/src/app/worker/persistence.py  (top of file)
"""The only writer of client-visible investigation data (spec §3). Every write
goes through shape(): raw_excerpt capped to 500 chars and defanged; finding
claims, the assessment summary, and each what_to_verify item defanged. The
pre-dedupe raw_sources/raw_findings channels are never persisted here."""
import json, uuid
from app import db
from app.graph.state import RawSubmission, Source, Finding, FinalAssessment
from app.graph.steps import StepDef
from app.security.defang import defang_text

_EXCERPT = 500

def shape(sources, findings, assessment, what_to_verify):
    sources = [s.model_copy(update={"raw_excerpt": defang_text((s.raw_excerpt or "")[:_EXCERPT])})
               for s in sources]
    findings = [f.model_copy(update={"claim": defang_text(f.claim)}) for f in findings]
    assessment = (assessment.model_copy(update={"summary": defang_text(assessment.summary)})
                  if assessment else None)
    what_to_verify = [defang_text(v) for v in (what_to_verify or [])]
    return sources, findings, assessment, what_to_verify
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/worker/test_persistence.py::test_shape_excerpts_and_defangs_everything_client_visible -v`
Expected: PASS.

- [ ] **Step 5: Write the failing idempotent-upsert test with a fake connection**

```python
# apps/api/tests/worker/test_persistence.py  (append)
import pytest
from app.graph.steps import STEP_REGISTRY
from app.worker.persistence import Persistence

class FakeCur:
    def __init__(self, store): self.store = store
    async def execute(self, sql, params=None): self.store.append((sql.split()[0].upper(), params))

class FakeConn:
    def __init__(self, store): self.store = store
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def execute(self, sql, params=None): self.store.append((" ".join(sql.split()[:2]).upper(), params))

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
    assert any("ON CONFLICT" in " ".join(str(x) for x in call).upper()
               or "INSERT" in call[0] for call in pool.store)
```

Write the assertion so it verifies the emitted SQL is an UPSERT (`INSERT ... ON CONFLICT (investigation_id, step_key) DO UPDATE`), matching spec §5 "upserts are idempotent."

- [ ] **Step 6: Run it, verify it fails; then implement `Persistence`**

Run: `uv run pytest tests/worker/test_persistence.py -v` → FAIL (`Persistence` missing). Then implement, using `db.get_pool()`:

```python
# apps/api/src/app/worker/persistence.py  (append)
class Persistence:
    async def seed(self, inv_id, steps: list[StepDef]) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            for s in steps:
                await c.execute(
                    "INSERT INTO investigation_steps "
                    "(investigation_id, step_key, label, display_order, status) "
                    "VALUES (%s,%s,%s,%s,'pending') ON CONFLICT DO NOTHING",
                    (inv_id, s.step_key, s.label, s.display_order))

    async def running(self, inv_id, step_key, at) -> None:
        await self._mark(inv_id, step_key, "running", started=at)

    async def done(self, inv_id, step_key, at) -> None:
        await self._mark(inv_id, step_key, "done", finished=at)

    async def _mark(self, inv_id, step_key, status, *, started=None, finished=None) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute(
                "INSERT INTO investigation_steps "
                "(investigation_id, step_key, label, display_order, status, started_at, finished_at) "
                "VALUES (%s,%s,'',0,%s,%s,%s) "
                "ON CONFLICT (investigation_id, step_key) DO UPDATE SET "
                "status=EXCLUDED.status, "
                "started_at=COALESCE(EXCLUDED.started_at, investigation_steps.started_at), "
                "finished_at=COALESCE(EXCLUDED.finished_at, investigation_steps.finished_at)",
                (inv_id, step_key, status, started, finished))

    async def backfill(self, inv_id) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute("UPDATE investigation_steps SET status='skipped' "
                            "WHERE investigation_id=%s AND status='pending'", (inv_id,))
            await c.execute("UPDATE investigation_steps SET status='failed', finished_at=now() "
                            "WHERE investigation_id=%s AND status='running'", (inv_id,))

    async def set_status(self, inv_id, status) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute("UPDATE investigations SET status=%s WHERE id=%s", (status, inv_id))

    async def get_submission(self, inv_id):
        pool = await db.get_pool()
        async with pool.connection() as c:
            cur = await c.execute("SELECT submission, status FROM investigations WHERE id=%s", (inv_id,))
            row = await cur.fetchone()
        return RawSubmission(**row["submission"]), row["status"]

    async def persist_result(self, inv_id, *, assessment, findings, sources, cost,
                             what_to_verify, check_count=None) -> None:
        sources, findings, assessment, what_to_verify = shape(sources, findings, assessment, what_to_verify)
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute(
                "UPDATE investigations SET assessment=%s, findings=%s, cost=%s, "
                "what_to_verify=%s, check_count=%s WHERE id=%s",
                (json.dumps(assessment.model_dump(mode="json")) if assessment else None,
                 json.dumps([f.model_dump(mode="json") for f in findings]),
                 json.dumps(cost), json.dumps(what_to_verify), check_count, inv_id))
```

Note the `_mark` UPSERT re-inserts placeholder `label=''`/`display_order=0` only on the impossible path where `seed` never ran; on the normal path `ON CONFLICT` preserves the seeded label/order. Add a comment saying so.

- [ ] **Step 7: Add the back-fill test and run the full file**

Add a test asserting `backfill` issues the two UPDATEs (pending→skipped, running→failed). Run: `uv run pytest tests/worker/test_persistence.py -v` → PASS.

---

## Task 5: Inngest functions + ASGI worker surface

Implements spec §6, §8 (run-investigation cache→run→persist→terminal; sweeper; deadline is a clean return; retries:2; `/api/inngest` + `/healthz`).

**Files:**
- Modify: `apps/api/pyproject.toml` (add `inngest`)
- Create: `apps/api/src/app/worker/functions.py`, `apps/api/src/app/worker/app.py`
- Test: `apps/api/tests/worker/test_functions.py`, `apps/api/tests/worker/test_app.py`

**Interfaces:**
- Consumes: `Persistence` (Task 4), `runner.run_and_emit` (Task 3), `app.cache.dedupe_key/get_cached_report/bump_check_count` (existing), `app.cost_tracker.summarize` (existing).
- Produces: `run_investigation_fn` and `sweep_stale_queued_fn` (Inngest functions) and an ASGI `app` serving them at `/api/inngest`, plus `GET /healthz` → `{"ok": true}`.
- Contract for the handler seam: `async def handle_requested(inv_id, *, persistence, run) -> str` returns the terminal status, so tests inject a stub `run` and a fake `persistence` (spec §10 "invoke handlers directly with a stubbed graph").

- [ ] **Step 1: Add the dependency**

Add `"inngest>=0.4"` to `apps/api/pyproject.toml` `dependencies`. Run: `uv lock` then `uv sync` (dependency resolution only — touches no database). Verify `uv run python -c "import inngest"` succeeds.

- [ ] **Step 2: Write the failing handler tests (success / cache-hit / timeout / failure)**

```python
# apps/api/tests/worker/test_functions.py
import uuid, pytest
from app.graph.state import RawSubmission, InvestigationState, FinalAssessment
from app.worker import functions

class FakePersistence:
    def __init__(self, submission, cached=None):
        self._sub = submission; self.status = None; self.result = None; self.backfilled = False
    async def get_submission(self, inv): return self._sub, "queued"
    async def set_status(self, inv, s): self.status = s
    async def persist_result(self, inv, **kw): self.result = kw
    async def backfill(self, inv): self.backfilled = True

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
```

- [ ] **Step 3: Run them, verify they fail**

Run: `uv run pytest tests/worker/test_functions.py -v`
Expected: FAIL — `app.worker.functions` missing.

- [ ] **Step 4: Implement the handler seam**

```python
# apps/api/src/app/worker/functions.py
"""Inngest workflow functions (spec §6). handle_requested is the testable core:
cache check -> running -> run+emit -> shaped persist -> terminal status. A soft
timeout is a clean return ('deadline_exceeded'); only unexpected exceptions
propagate to Inngest's retry budget (retries:2) and on_failure (gap #5, spec §8)."""
import logging, uuid
from app import cache
from app.cost_tracker import summarize
from app.worker.persistence import Persistence
from app.worker.runner import run_and_emit

logger = logging.getLogger(__name__)

async def handle_requested(inv_id: uuid.UUID, *, persistence: Persistence, run=run_and_emit) -> str:
    submission, _status = await persistence.get_submission(inv_id)

    key = cache.dedupe_key(submission)
    if key:
        cached = await cache.get_cached_report(key)
        if cached is not None:
            n = await cache.bump_check_count(key)
            await persistence.persist_result(
                inv_id, assessment=_a(cached), findings=_f(cached), sources=_s(cached),
                cost=cached.get("cost", {}), what_to_verify=cached.get("what_to_verify", []),
                check_count=n)
            await persistence.set_status(inv_id, "done")   # cache-hit writes NO steps (spec §5)
            return "done"

    await persistence.set_status(inv_id, "running")
    state, status = await run(inv_id, submission, persistence)   # may raise -> Inngest retry
    cost = summarize(state.cost_events)
    what = state.deterministic_signals.get("what_to_verify", [])
    await persistence.persist_result(inv_id, assessment=state.assessment, findings=state.findings,
                                     sources=state.sources, cost=cost, what_to_verify=what)
    await persistence.set_status(inv_id, status)               # 'done' | 'deadline_exceeded'
    if key and status == "done":
        await cache.put_cached_report(key, {
            "assessment": state.assessment.model_dump(mode="json") if state.assessment else None,
            "findings": [f.model_dump(mode="json") for f in state.findings],
            "sources": [s.model_dump(mode="json") for s in state.sources],
            "cost": cost, "what_to_verify": what})
    return status

# cached-report reconstruction helpers (kept local; the cache stores model dumps)
from app.graph.state import FinalAssessment, Finding, Source
def _a(c): return FinalAssessment(**c["assessment"]) if c.get("assessment") else None
def _f(c): return [Finding(**x) for x in c.get("findings", [])]
def _s(c): return [Source(**x) for x in c.get("sources", [])]
```

- [ ] **Step 5: Run the handler tests, verify they pass**

Run: `uv run pytest tests/worker/test_functions.py -v`
Expected: PASS.

- [ ] **Step 6: Add the sweeper handler + test**

Write `test_sweep_stale_queued` with a fake persistence exposing `stale_queued() -> [ids]` and `zombie_running() -> [ids]`, asserting the sweeper re-emits an event per stale-queued id (via an injected `emit` callable) and calls `set_status(id, "failed")` + `backfill(id)` per zombie-running id (spec §6). Then implement `async def handle_sweep(*, persistence, emit)` in `functions.py`, and add the two persistence queries (`stale_queued`, `zombie_running`) with a threshold from `settings` (add `stale_queued_threshold_s: float = 900.0` and reuse `total_deadline_s` for the hard-deadline zombie cutoff in `config.py`). Run the test → PASS.

- [ ] **Step 7: Write the ASGI app test**

```python
# apps/api/tests/worker/test_app.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.worker.app import app

async def test_healthz_ok():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}

async def test_inngest_endpoint_is_served():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.put("/api/inngest")     # SDK introspection responds 2xx/200-ish
    assert r.status_code < 500
```

- [ ] **Step 8: Run it, verify it fails; then implement the ASGI app**

Run → FAIL (`app.worker.app` missing). Implement:

```python
# apps/api/src/app/worker/app.py
"""The entire HTTP surface (spec §6): Inngest serve + liveness. No user routes."""
import uuid
import inngest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
import inngest.experimental.starlette as inngest_starlette  # confirm exact serve module at impl time

from app.worker.functions import handle_requested, handle_sweep
from app.worker.persistence import Persistence

inngest_client = inngest.Inngest(app_id="job-hunt-verification", is_production=False)

@inngest_client.create_function(fn_id="run-investigation",
                                trigger=inngest.TriggerEvent(event="investigation.requested"),
                                retries=2)
async def run_investigation_fn(ctx: inngest.Context) -> str:
    inv_id = uuid.UUID(ctx.event.data["investigation_id"])
    return await handle_requested(inv_id, persistence=Persistence())

@inngest_client.create_function(fn_id="sweep-stale-queued",
                                trigger=inngest.TriggerCron(cron="*/10 * * * *"))
async def sweep_stale_queued_fn(ctx: inngest.Context) -> None:
    async def emit(inv_id):
        await inngest_client.send(inngest.Event(
            name="investigation.requested", id=str(inv_id),
            data={"investigation_id": str(inv_id)}))
    await handle_sweep(persistence=Persistence(), emit=emit)

async def healthz(_req): return JSONResponse({"ok": True})

app = Starlette(routes=[Route("/healthz", healthz)])
inngest_starlette.serve(app, inngest_client,
                        [run_investigation_fn, sweep_stale_queued_fn])
```

> At implementation time, verify the exact Inngest Python SDK serve helper and decorator signatures against the installed version (`opensrc path inngest` / the package's `__init__`); the names above (`TriggerEvent`, `TriggerCron`, `experimental.starlette`) may differ by version. Adjust to match; keep the two-route surface.

- [ ] **Step 9: Run the app test + the whole worker suite**

Run: `uv run pytest tests/worker -v`
Expected: PASS. Fix any signature drift surfaced by the real SDK.

---

## Task 6: V0 teardown + operator smoke script

Implements spec §1, §3 (clean break: delete the FastAPI route layer, owner-key, OpenAPI→api-types pipeline, docker-compose) and §10 (operator-run e2e smoke).

> **Sequencing:** deleting `packages/api-types` and the OpenAPI pipeline removes what the **current** V0 web app imports. Per spec §11 the web pages are owned by the redesign; this task lands the server-side teardown and must be sequenced with the web-redesign branch so `main` is never left with a web app importing deleted packages. If the redesign has not landed, keep this task on its own branch until it can merge together. Do not delete `apps/web/lib/ownerKey.ts` or `apps/web/lib/api.ts` here — those belong to the web redesign (spec §7.7).

**Files:**
- Delete: `apps/api/src/app/main.py` route/owner-key/memory-store code; `apps/api/scripts/dump_openapi.py`; `apps/api/tests/test_openapi_dump.py`; `packages/api-types/`; `scripts/gen-types.mjs`; `docker-compose.yml`.
- Modify: `apps/api/src/app/db.py` (drop `init_tables`, `owner_key` SQL); `apps/api/tests/test_api.py` (remove owner-key route tests); `apps/api/tests/test_db.py`.
- Create: `scripts/smoke_e2e.md`.

- [ ] **Step 1: Delete the OpenAPI pipeline; prove the suite still green without it**

Delete `apps/api/scripts/dump_openapi.py`, `apps/api/tests/test_openapi_dump.py`, `packages/api-types/`, `scripts/gen-types.mjs`. Run: `uv run pytest -q` (from `apps/api`).
Expected: PASS with those tests gone and no import errors. Grep the repo for remaining `@job-hunt/api-types` / `dump_openapi` references: `git grep -n "api-types\|dump_openapi"` → only historical docs, no live code.

- [ ] **Step 2: Remove the FastAPI route layer and owner-key logic**

Delete from `apps/api/src/app/main.py`: `create`, `get`, `_require_owner_key`, `_run_with_deadline`, `_persist`, `load_result`, `_excerpt_sources`, `_RESULTS`, `_use_memory_store`, the `CreateRequest/Response`/`InvestigationResponse` models, and the `X-Owner-Key` handling. If nothing user-facing remains, delete `main.py` entirely (the worker's `app.py` is the new entrypoint). Update `apps/api/tests/test_api.py`: delete every owner-key/route test (the whole file if it only covered routes).

- [ ] **Step 3: Prune `db.py`**

Remove `init_tables()` and any `owner_key`/`sources`/`cache` DDL that migrations now own. Keep `get_pool()`. Keep `save_raw_source`/`load_raw_sources` only if a worker path still uses them — grep first (`git grep -n "save_raw_source\|load_raw_sources"`); if unused after Tasks 3–5, delete them and their tests in `test_db.py`.

- [ ] **Step 4: Run the full backend suite**

Run: `uv run pytest -q` (from `apps/api`).
Expected: PASS — the surviving suite is graph nodes, security, cache, cost, and the new `worker/` + `graph/test_steps.py` tests. No references to deleted symbols.

- [ ] **Step 5: Write the operator e2e smoke doc**

Create `scripts/smoke_e2e.md`: against local `supabase start` + `npx inngest-cli dev`, (1) sign in via the Auth REST API to get a JWT, (2) `insert` an `investigations` row via PostgREST with that JWT, (3) observe `investigation_steps` arriving over Realtime, (4) `select` the finished row. Mark it **operator-run**; the implementation never executes it. Cross-reference `scripts/RUNBOOK.md`.

- [ ] **Step 6: Delete `docker-compose.yml`**

Remove `docker-compose.yml` (Postgres now comes from the Supabase CLI stack, spec §9). Grep for references in CI (`.github/workflows/ci.yml`) and docs; update CI so it does not `docker compose up` a database — the Python suite is fully faked and needs no live DB. Run: `uv run pytest -q` once more → PASS.

---

## Self-Review

**Spec coverage:**
- §3 architecture / one durable function → Task 5 (`run_investigation_fn` wraps the whole run; checkpointer via runner). ✅
- §3 write-time shaping → Task 4 (`shape`, `persist_result`) + §10 guardrail test. ✅
- §3 dedupe-in-function → Task 5 (`handle_requested` cache branch). ✅
- §4 auth/RLS/CHECK → Task 1 (policies, defaults trigger, presence+length CHECK). ✅
- §5 schema, steps table, publication (gap #1), registry, emission, back-fill, cache-hit-no-steps → Tasks 1, 3, 5. ✅
- §5 webhook chain / Edge Function (gap #2) → Tasks 1 (trigger) + 2 (function). ✅
- §5/§3 checkpointer tables authored (gap #3) → Task 1 (checkpointer migration). ✅
- §6 worker surface + two functions → Task 5. ✅
- §8 idempotency, deadline-clean-return (gap #5), retries/on_failure → Tasks 3, 5 (tests assert clean return vs raise). ✅
- §9 env/config → Tasks 2 (Edge secrets), 5 (deps/config), 6 (docker-compose delete). ✅
- §10 testing (emission, functions, shaping, RLS script, e2e smoke) → Tasks 1, 3, 4, 5, 6. ✅
- §1/§3 deletions (routes, owner-key, OpenAPI→api-types) → Task 6. ✅
- gap #4 non-null CHECK → Task 1 (constraint + `verify_rls.sql` case 5). ✅

**Placeholder scan:** every code step carries real code; SQL/TS/Python are concrete. The two "confirm against the installed version" notes (Inngest SDK serve helper; `astream_events` event shape) are explicit verification instructions, not deferred work — the surrounding code is complete and the note says exactly what to check.

**Type consistency:** `StepDef(step_key,label,display_order)` used identically in Tasks 3–4; `StepSink`/`Persistence` methods (`seed/running/done/backfill/set_status/get_submission/persist_result`) match between Tasks 3, 4, 5; `shape(...)` returns `(sources, findings, assessment, what_to_verify)` consumed the same way in Task 5; Inngest event `data.investigation_id` produced in Task 2, consumed in Task 5.

---

## Execution Handoff

Two open verification points the executor must resolve against installed versions (both flagged inline, neither blocks planning): the exact **Inngest Python SDK** serve/ decorator API (Task 5 Step 8) and the exact **`langgraph` 1.x `astream_events`** event dict shape (Task 3 Step 8). Everything else is fully specified.
