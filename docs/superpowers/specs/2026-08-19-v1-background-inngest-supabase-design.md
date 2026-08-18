# V1: Background Investigations via Inngest + Supabase (Auth, DB, Realtime Progress)

**Date:** 2026-08-19
**Status:** Approved design (backend + frontend contract; frontend pages descoped — web redesign will build against the contract in §7)

## 1. Overview

V0 runs the investigation graph synchronously inside `POST /investigations`,
holding the HTTP request open for 1–3 minutes, with ownership by an anonymous
per-browser `X-Owner-Key`. This feature makes investigations background jobs:

- `POST /investigations` returns `201 {id}` immediately with status `queued`.
- The graph runs as a durable **Inngest** function (Inngest replaces the
  previously designated FastAPI BackgroundTasks approach — direct adoption of
  the spec's designated upgrade).
- Per-node progress is written to Postgres and streamed to the browser via
  **Supabase Realtime** — the user sees each step live, can close the tab,
  and can come back later (any device) to the same state.
- **Supabase Auth** (required sign-in: email/password + Google OAuth)
  replaces `X-Owner-Key`. Clean break: V0 anonymous data is dropped, the
  owner-key path is deleted outright.

Final reports keep flowing through the typed FastAPI `GET` (all response
shaping — source excerpting, defanging — stays server-side). Supabase
Realtime carries only the lightweight step ticker.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Supabase depth | Auth + DB + Realtime for progress; FastAPI keeps commands + final report |
| Auth model | Required sign-in: email/password (with confirmation) + Google OAuth. No anonymous tier |
| Execution | Inngest (Python SDK, mounted on the FastAPI app; Inngest Dev Server locally, Inngest Cloud in prod) |
| V0 data | Clean break — drop V0 rows, delete `X-Owner-Key`/`ownerKey.ts`/`owner_key` column |
| Progress UX | Per-node checklist: fixed human-readable steps, `pending/running/done/skipped/failed` + timestamps |
| Frontend pages | **Descoped** (web redesign owns them); this feature ships the backend + integration contract (§7) |

## 3. Architecture

```
Browser (redesigned web, later: Next.js + supabase-js)
  │  Authorization: Bearer <supabase access_token>
  ▼
FastAPI ── POST /investigations ─ insert row (status=queued, user_id) ─► Supabase Postgres
  │             └─ send Inngest event "investigation.requested" (event id = investigation id)
  │◄─ GET /investigations/{id}   (typed result + step states, shaped/defanged)
  │◄─ GET /investigations        (user's history, newest first)
  │
Inngest function (served at /api/inngest on the same FastAPI app)
  └─ runs the LangGraph via astream_events
       ├─ node start/end → upsert investigation_steps ─► Postgres ─► Realtime ─► Browser
       └─ finish → persist result, terminal status
```

- **One durable function, not per-node Inngest steps.** The function wraps
  the whole graph run. Layering: Inngest owns "the run happens, retries,
  eventually settles"; LangGraph's Postgres checkpointer (thread id =
  investigation id) owns "where inside the run we are" — an Inngest retry
  resumes from the last completed node, never restarts.
- **Two read paths, deliberately split.** Live progress: browser subscribes
  via supabase-js Realtime to its own `investigation_steps` rows (RLS).
  Results: the typed FastAPI GET. The GET also returns current step states,
  so a plain refresh/re-mount is always correct without Realtime.
- **Statuses:** `queued → running → done | failed | deadline_exceeded`.
  The cache-dedupe hit path still short-circuits POST straight to `done`.
- Deleted: `_run_with_deadline` (route-level), the BackgroundTasks V1 TODO,
  `_RESULTS`-as-production-fallback framing (the memory store survives as
  test-only), `_require_owner_key`, `X-Owner-Key` everywhere.

## 4. Auth

- **Supabase project config:** email/password with email confirmation +
  Google OAuth. `auth.users` is the only identity table;
  `investigations.user_id uuid not null references auth.users(id)`.
- **FastAPI (`app/auth.py`):** verifies the JWT **locally** with `pyjwt`.
  The Supabase project uses asymmetric signing keys (ES256/RS256; enable in
  project settings if on legacy HS256) so verification is JWKS-based —
  JWKS fetched once at startup, cached, re-fetched on unknown `kid`;
  signature/expiry/audience checked; `sub` → `user_id`. No per-request
  network call, no supabase-py dependency. Routes use
  `user_id: uuid.UUID = Depends(current_user_id)`.
- **Ownership semantics unchanged (spec §9.6):** wrong/absent user on GET →
  **404, never 403** — no resource-existence leak. Missing/invalid token on
  any route → 401.
- **RLS:** the API connects with the service-role/direct connection string
  (bypasses RLS; psycopg pool unchanged). RLS exists for what browsers read
  via supabase-js: `SELECT ... USING (user_id = auth.uid())` on
  `investigations`, and on `investigation_steps` via join to its
  investigation. **No INSERT/UPDATE policies** — browsers read, only the
  API writes.

## 5. Schema & progress emission

Migrations are authored as Supabase CLI files in `supabase/migrations/`
(replacing `init_tables()` DDL-on-startup and the docker-compose Postgres).

> **Constraint: implementation must NOT run `supabase start`, `supabase db
> push`, `supabase migration up`, or any other command that applies
> migrations or touches a database. Migration files are authored and
> reviewed only; the operator (Ron) applies them manually.** Tests that
> would need a live database are written against the test-only memory store
> or documented as operator-run steps.

- `investigations`: drop `owner_key`; add `user_id` (FK to `auth.users`);
  `status` default becomes `queued`, adds `failed`. Other columns
  (`submission`, `assessment`, `findings`, `cost`, `what_to_verify`,
  `created_at`) unchanged. `sources` and `cache` tables unchanged.
- `investigation_steps` (new): `investigation_id uuid` FK (cascade delete),
  `step_key text`, `status text` (`pending|running|done|skipped|failed`),
  `started_at timestamptz`, `finished_at timestamptz`,
  PK `(investigation_id, step_key)`. Added to the `supabase_realtime`
  publication.
- **Step registry (`app/graph/steps.py`):** one dict, graph node name →
  `(step_key, human label, display order)`, covering user-meaningful nodes
  (roughly: intake/extraction, company research, deterministic checks,
  evidence analysis, devil's advocate, report — final mapping read off
  `build.py`'s node list at implementation time). Internal plumbing nodes
  emit nothing. The registry is the single source for emission **and**
  display labels/order (exposed through the GET response — the frontend
  never hardcodes step names).
- **Emission:** on run start, bulk-insert all registry steps as `pending`;
  consume `graph.astream_events(...)`: `on_chain_start` of a registered
  node → upsert `running` + `started_at`; `on_chain_end` → `done` +
  `finished_at`. On terminal failure/deadline: still-`pending` → `skipped`,
  in-flight → `failed`. Upserts are idempotent, so a retry replaying
  completed nodes rewrites identical terminal rows.
- **Cache-hit path writes no steps**; the checklist only exists for runs
  that actually executed.

## 6. API surface

| Route | Change |
|---|---|
| `POST /investigations` | Auth required. Validate + cache-check as today; on miss: insert `queued` row, send `investigation.requested` (event id = investigation id), return `201 {id}` immediately. Cache hit: persist as `done`, return id (unchanged semantics). If the event send fails: mark row `failed`, return 500 — never a silently dead `queued` row |
| `GET /investigations/{id}` | Auth required; 404 on wrong owner. Response gains `steps: [{key, label, order, status, started_at, finished_at}]` and the new status values |
| `GET /investigations` (new) | Auth required. The caller's investigations, newest first: `[{id, status, created_at, verdict summary}]` — makes "come back later" real without bookmarked URLs |
| `POST/PUT /api/inngest` (new) | Inngest serve endpoint (SDK-managed, signature-verified via `INNGEST_SIGNING_KEY`) |

`@job-hunt/api-types` is regenerated from the OpenAPI dump after the changes.

## 7. Frontend integration contract (for the web redesign)

The redesigned web app must:

1. Use `@supabase/ssr` / supabase-js for sign-in (email/password + Google);
   send `Authorization: Bearer <access_token>` on every API call. Handle
   401 by re-authenticating.
2. After POST, navigate to the investigation view. **On mount, always GET
   first** — render checklist state (or the finished report) from the
   response. A returning user (hours later, any device) lands correct with
   zero streaming involved.
3. While status is `queued`/`running`, subscribe via Realtime to
   `investigation_steps` UPDATE/INSERT filtered
   `investigation_id=eq.{id}`; patch rows in place. Render labels/order
   from the GET's `steps` payload, never hardcoded.
4. On a Realtime event completing the last step, on any terminal status,
   or on a channel error → unsubscribe and refetch the GET. Realtime being
   down degrades to refresh-driven, never stuck.
5. History view = `GET /investigations`.
6. Delete `lib/ownerKey.ts` + its test; `lib/api.ts` switches to Bearer
   auth; regenerate api-types.

## 8. Error handling & idempotency

- Inngest event id = investigation id → duplicate sends never double-run.
  Retries capped at 2 (checkpoint-resume makes them cheap).
- Soft-deadline behavior preserved: `asyncio.wait_for` inside the function;
  on timeout persist best-effort checkpoint state as `deadline_exceeded`
  (unverifiable findings still lower confidence, as today).
- Exhausted retries → `on_failure` → status `failed`, steps back-filled
  (`skipped`/`failed`). Nothing remains `running` forever.
- The no-leak exception handler stays: client-visible errors carry no
  internals; details log server-side only.

## 9. Environments & config

- **Local:** `supabase start` (CLI stack) for Postgres/Auth/Realtime —
  *operator-run, never by the implementation* — and `npx inngest-cli dev`
  for Inngest. `docker-compose.yml` is deleted.
- **Prod:** Supabase hosted project + Inngest Cloud.
- **Env vars:** `DATABASE_URL` (Supabase direct/service connection),
  `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `INNGEST_EVENT_KEY`,
  `INNGEST_SIGNING_KEY`.

## 10. Testing

TDD throughout (red/green per task); folded into each implementation phase.

- **Auth dependency:** locally generated keypair signs test JWTs — valid /
  expired / wrong-audience / wrong-key / missing → correct 401/404 paths.
- **Step emission:** fake `astream_events` sequences → exact upsert
  sequence asserted, including skipped/failed back-fill and idempotent
  replay.
- **Inngest function:** invoke the handler directly with a stubbed graph —
  success, timeout, and failure paths each leave the right statuses/steps.
- **Routes:** POST returns 201 `queued` with event send mocked; cache hit →
  `done`, no steps; event-send failure → row `failed` + 500; GET ownership
  404s; list ordering. Run against the test-only memory store — no live DB.
- **End-to-end smoke:** a documented script (sign-in via auth REST API →
  POST → observe Realtime → GET) against local Supabase + Inngest dev
  server, standing in for the descoped UI. **Operator-run** (it needs a
  live database); the implementation ships the script + runbook only.

## 11. Out of scope

Frontend pages (web redesign owns them, per §7). Per-user rate limiting
(now unblocked by real accounts, still deferred). Conversation paste,
re-research loop, Stripe, PII retention job (separate V1 items). Migration
of V0 owner-key data (clean break). Running any database migration or
Supabase/DB process (operator-only).
