# V1: Supabase-First Background Investigations (Inngest Worker + Supabase Auth/DB/Realtime)

**Date:** 2026-08-19
**Status:** Approved design (backend + frontend contract; frontend pages descoped — web redesign will build against the contract in §7)

## 1. Overview

V0 runs the investigation graph synchronously inside a FastAPI
`POST /investigations`, holding the request open for 1–3 minutes, with
ownership by an anonymous per-browser `X-Owner-Key`. V1 restructures this
**Supabase-first**:

- The browser talks to **Supabase directly** (supabase-js): sign-in, submit
  (row INSERT under RLS), live step progress (Realtime), and reading
  results/history (SELECT under RLS). There are **no user-facing Python
  endpoints anymore.**
- **Python survives only as the Inngest workflow service**: an ASGI app
  exposing the SDK-managed `/api/inngest` endpoint (plus `/healthz`). It
  runs the LangGraph investigation, emits per-step progress, and persists
  the shaped result via the service-role connection.
- A database webhook (a `pg_net` trigger, versioned in migrations) sends
  the `investigation.requested` event to Inngest when a row is inserted.
- **Supabase Auth** (required sign-in: email/password + Google OAuth)
  replaces `X-Owner-Key`. Clean break: V0 anonymous data is dropped and the
  entire FastAPI route layer (`main.py` routes, owner-key logic, the
  OpenAPI → `@job-hunt/api-types` pipeline) is deleted.

The user sees each investigation step live, can close the tab, and can come
back later from any device to the same state.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Supabase depth | **Supabase-first**: browser ↔ Supabase for auth, submit, progress, reads. Python has no user-facing routes |
| Auth model | Required sign-in: email/password (with confirmation) + Google OAuth. No anonymous tier |
| Execution | Inngest (Python SDK on an ASGI app; Inngest Dev Server locally, Inngest Cloud in prod) |
| V0 data | Clean break — drop V0 rows; delete `X-Owner-Key`, `ownerKey.ts`, `owner_key` column, all FastAPI user routes |
| Progress UX | Per-node checklist: fixed human-readable steps, `pending/running/done/skipped/failed` + timestamps |
| Frontend pages | **Descoped** (web redesign owns them); this feature ships backend + integration contract (§7) |

## 3. Architecture

```
Browser (redesigned web, later: Next.js + supabase-js)
  │ sign-in (Supabase Auth) · INSERT investigations (RLS) ·
  │ SELECT investigations/steps (RLS) · Realtime subscribe (steps)
  ▼
Supabase (Postgres + Auth + Realtime)
  │ on INSERT investigations → pg_net webhook trigger
  ▼
Inngest ── invokes over HTTP ──► Python worker (ASGI, /api/inngest only)
                                    └─ runs LangGraph via astream_events
                                        ├─ node start/end → upsert
                                        │   investigation_steps ─► Realtime ─► Browser
                                        └─ finish → persist shaped result,
                                            terminal status (service role)
```

- **One durable function, not per-node Inngest steps.** The function wraps
  the whole graph run. Layering: Inngest owns "the run happens, retries,
  eventually settles"; LangGraph's Postgres checkpointer (thread id =
  investigation id) owns "where inside the run we are" — an Inngest retry
  resumes from the last completed node, never restarts.
- **Shaping moves to write time.** V0's GET endpoint enforced source
  excerpting and defanging at read time. Now the worker is the **only
  writer** of `assessment`/`findings`/`sources`, and it persists only
  already-shaped data (excerpted, defanged, capped). Clients read rows
  as-is under RLS; the worker's tests become the guardrail. The pre-dedupe
  `raw_sources`/`raw_findings` accumulator channels are never persisted to
  client-readable tables (unchanged invariant).
- **Dedupe cache moves into the function.** First thing the run does is the
  cache check; on a hit it copies the cached shaped report onto the row,
  bumps `check_count`, marks `done`, and exits — one cheap Inngest run
  instead of a synchronous short-circuit.
- **Statuses:** `queued → running → done | failed | deadline_exceeded`.
- **No-leak property is structural:** under RLS, rows you don't own don't
  exist for you — the spec §9.6 "404, never 403" guarantee is inherited,
  not implemented.
- Deleted: all user-facing FastAPI routes, `_run_with_deadline`
  (route-level), `_require_owner_key`, `_RESULTS` production fallback (a
  memory store may survive purely for unit tests), the OpenAPI dump script
  and `packages/api-types`.

## 4. Auth & RLS

- **Supabase project config:** email/password with email confirmation +
  Google OAuth. `auth.users` is the only identity table.
- **Python verifies nothing:** it never receives user requests. Inngest
  calls are authenticated by the SDK's signature check
  (`INNGEST_SIGNING_KEY`); DB access uses the service-role/direct
  connection string (bypasses RLS; psycopg pool unchanged).
- **RLS policies (all in migrations):**
  - `investigations`: `INSERT ... WITH CHECK (user_id = auth.uid())`
    (client may set only submission fields — a trigger forces
    `status='queued'` and server-set columns to defaults regardless of
    what the client sends); `SELECT ... USING (user_id = auth.uid())`.
    No client UPDATE/DELETE.
  - `investigation_steps`: `SELECT` via join to the owning investigation.
    No client writes.
  - `sources`, `cache`: no client policies at all (worker-only via
    service role). Client-visible source excerpts live inside the shaped
    report JSON, as V0's response did.
- **Input validation at the boundary:** CHECK constraints replace Pydantic
  route validation — `char_length(submission->>'job_text')` within the
  configured cap and non-empty; oversize input fails the INSERT itself.
  Semantic validation stays in the graph's intake node, as today.

## 5. Schema & progress emission

Migrations are authored as Supabase CLI files in `supabase/migrations/`
(replacing `init_tables()` DDL-on-startup and the docker-compose Postgres).

> **Constraint: implementation must NOT run `supabase start`, `supabase db
> push`, `supabase migration up`, or any other command that applies
> migrations or touches a database. Migration files are authored and
> reviewed only; the operator (Ron) applies them manually.** Tests that
> would need a live database are shipped as operator-run scripts.

- `investigations`: drop `owner_key`; add `user_id uuid not null references
  auth.users(id)`; `status text not null default 'queued'` (values:
  `queued|running|done|failed|deadline_exceeded`); add
  `check_count int` (dedupe-hit counter surfaced to the UI); keep
  `submission`, `assessment`, `findings`, `cost`, `what_to_verify`,
  `created_at`. CHECK constraints per §4.
- `investigation_steps` (new): `investigation_id uuid` FK (cascade delete),
  `step_key text`, `label text`, `display_order int`, `status text`
  (`pending|running|done|skipped|failed`), `started_at`, `finished_at`,
  PK `(investigation_id, step_key)`. In the `supabase_realtime`
  publication. Label and order are denormalized onto the rows so the
  frontend renders entirely from data — no hardcoded step names.
- **Webhook trigger** (in migrations): AFTER INSERT on `investigations` →
  `pg_net` POST to the Inngest event API (`investigation.requested`,
  event id = investigation id). The Inngest event key is stored via
  Supabase Vault, not inline in the trigger source.
- **Step registry (`app/graph/steps.py`):** one dict, graph node name →
  `(step_key, label, display order)`, covering user-meaningful nodes
  (roughly: intake/extraction, company research, deterministic checks,
  evidence analysis, devil's advocate, report — final mapping read off
  `build.py`'s node list at implementation time). Internal plumbing nodes
  emit nothing.
- **Emission:** on run start, bulk-insert all registry steps as `pending`;
  consume `graph.astream_events(...)`: `on_chain_start` of a registered
  node → upsert `running` + `started_at`; `on_chain_end` → `done` +
  `finished_at`. On terminal failure/deadline: still-`pending` → `skipped`,
  in-flight → `failed`. Upserts are idempotent, so a retry replaying
  completed nodes rewrites identical terminal rows.
- **Cache-hit runs write no steps**; the checklist only exists for runs
  that actually executed.

## 6. Python worker surface

| Route | Purpose |
|---|---|
| `POST/PUT /api/inngest` | Inngest serve endpoint (SDK-managed, signature-verified) |
| `GET /healthz` | Liveness for the deployment platform |

That is the entire HTTP surface. Functions registered:

1. **`run-investigation`** (trigger: `investigation.requested`): cache
   check → status `running` → seed steps → run graph with soft deadline →
   persist shaped result → terminal status. Retries: 2.
2. **`sweep-stale-queued`** (cron, ~every 10 min): any `queued` row older
   than a threshold (webhook delivery lost) → re-emit its event. Any
   `running` row far past the hard deadline → mark `failed`, back-fill
   steps. Nothing can be stuck forever.

## 7. Frontend integration contract (for the web redesign)

The redesigned web app must:

1. Use `@supabase/ssr` / supabase-js for sign-in (email/password + Google)
   and for **all** data access — there is no REST API to call.
2. Submit = `insert` into `investigations` with the submission JSON
   (`job_text` required; `company_name`, `recruiter_email`, `job_url`
   optional) and own `user_id`; navigate to the investigation view with
   the returned id. Constraint violations (e.g. oversize job text) surface
   as insert errors — validate client-side first for good UX.
3. On mount, **SELECT first** (investigation row + its steps) — render
   checklist or finished report from that. A returning user (hours later,
   any device) lands correct with zero streaming involved.
4. While `queued`/`running`: Realtime-subscribe to `investigation_steps`
   INSERT/UPDATE filtered `investigation_id=eq.{id}`; patch rows in place,
   ordered by `display_order`, labeled by `label`. Also subscribe to the
   investigation row's UPDATE for the status flip.
5. On terminal status or channel error → unsubscribe and re-SELECT.
   Realtime being down degrades to refresh-driven, never stuck.
6. History view = SELECT own `investigations`, newest first.
7. Types come from `supabase gen types typescript` (operator-run against
   the local stack; committed to the repo). `packages/api-types` and
   `lib/ownerKey.ts` are deleted.

## 8. Error handling & idempotency

- Inngest event id = investigation id → duplicate sends (webhook retries,
  sweeper re-emits) never double-run.
- Soft-deadline behavior preserved: `asyncio.wait_for` inside the function;
  on timeout persist best-effort checkpoint state as `deadline_exceeded`
  (unverifiable findings still lower confidence, as today).
- Exhausted retries → `on_failure` → status `failed`, steps back-filled.
  The stale sweeper (§6) covers lost-webhook and zombie-`running` cases.
- Client-visible data never includes secrets or cost internals beyond the
  same summarized `cost` object V0's API returned; errors/logs stay
  server-side (worker logging only — clients never see worker errors,
  only a `failed` status).

## 9. Environments & config

- **Local:** `supabase start` (CLI stack) for Postgres/Auth/Realtime —
  *operator-run, never by the implementation* — and `npx inngest-cli dev`
  for Inngest. `docker-compose.yml` is deleted.
- **Prod:** Supabase hosted project + Inngest Cloud + the Python worker
  deployed anywhere ASGI runs.
- **Worker env vars:** `DATABASE_URL` (Supabase direct/service
  connection), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- **Supabase config:** Google OAuth credentials; Vault secret for the
  webhook's Inngest event key.

## 10. Testing

TDD throughout (red/green per task); folded into each implementation phase.

- **Step emission:** fake `astream_events` sequences → exact upsert
  sequence asserted, including skipped/failed back-fill and idempotent
  replay.
- **Inngest functions:** invoke handlers directly with a stubbed graph —
  success, cache-hit, timeout, and failure paths each leave the right
  statuses/steps; sweeper re-emits/fails the right rows. DB calls go
  through a thin persistence module that unit tests fake.
- **Write-time shaping:** the persistence path is tested to only ever
  store excerpted sources and defanged text (this replaces V0's
  GET-shaping tests — it is now the only guardrail).
- **Migrations/RLS:** authored with an **operator-run** verification
  script (`scripts/verify_rls.sql` + runbook): as user A insert/select own
  rows, fail to read user B's rows, fail to update status, oversize insert
  rejected, webhook trigger fires. Not run by the implementation.
- **End-to-end smoke:** a documented **operator-run** script (sign-in via
  auth REST API → insert → observe Realtime → select) against local
  Supabase + Inngest dev server, standing in for the descoped UI.

## 11. Out of scope

Frontend pages (web redesign owns them, per §7). Per-user rate limiting
(future: DB trigger or Edge Function — noted that FastAPI middleware is no
longer an option). Conversation paste, re-research loop, Stripe, PII
retention job (separate V1 items). Migration of V0 owner-key data (clean
break). Running any database migration, Supabase process, or live-DB test
(operator-only).
