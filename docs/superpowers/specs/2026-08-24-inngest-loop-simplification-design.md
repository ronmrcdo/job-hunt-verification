# Inngest Loop Simplification: Internal Hops, No Edge Function

**Date:** 2026-08-24
**Status:** Proposed design — awaiting review
**Supersedes (partially):** `2026-08-19-v1-background-inngest-supabase-design.md` §5 emit chain

## 1. Overview

The path from "user submits" to "investigation runs" is four network hops,
three of which cross the public internet:

```
web → INSERT investigations
    → pg_net → https://<edge>/emit-investigation-requested   [public]
    → Edge Function → https://jobverifai-inngest.../e/<key>   [public]
    → Inngest → https://jobverifai-worker.../api/inngest      [public]
    → run_investigation_fn → LangGraph run
```

The production incidents recorded against this system so far have all landed
on one of those public hops: Cloudflare Access intercepting `/fn/register` and `/e/*`,
and a Traefik redirect downgrading the executor `POST` to a `GET`.

**Inngest is retained.** The pod, its Postgres, the retry budget, `on_failure`,
the cron sweeper and the dashboard all stay. This design removes only the
public exposure and one redundant deploy channel:

```
web → INSERT investigations
    → pg_net → http://inngest:8288/e/<key>                    [internal]
    → Inngest → http://api-worker:8000/api/inngest            [internal]
    → run_investigation_fn → LangGraph run
```

Four hops become two. No job traffic leaves the Docker network. The Inngest
dashboard remains publicly routed and is the only human-facing surface.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Workflow engine | **Keep Inngest.** No migration to a pull-based engine |
| Executor callback | Internal Docker DNS via `INNGEST_SERVE_ORIGIN` |
| Worker → Inngest | Internal Docker DNS via `INNGEST_BASE_URL` |
| DB → Inngest | `pg_net` posts the Inngest event **directly**; Edge Function deleted |
| Secrets in SQL | Unchanged — URL and key stay in DB settings, never in migration SQL |
| Dashboard | Stays public, keeps basic auth |
| `sweep_stale_queued_fn` | Unchanged — remains the delivery backstop |

## 3. Change 1 — Internalize the executor callback

`inngest.fast_api.serve` accepts `serve_origin`, resolved from
`INNGEST_SERVE_ORIGIN` (`_internal/config_lib.py:10`). It is the URL the SDK
advertises during app sync — the address Inngest calls back on.

**Change:** set `INNGEST_SERVE_ORIGIN=http://api-worker:8000` in the prod
environment.

**Then delete:**
- the worker's Traefik labels (`docker-compose.prod.yml:85-87`)
- `WORKER_HOST` from `.env.production.example`
- the `jobverifai-worker.ronmrcdo.dev` DNS record
- the Cloudflare Access bypass rule covering the worker

This makes production match development, which has always used internal DNS
(`docker-compose.yml:49`: `inngest dev -u http://api-worker:8000/api/inngest`).

`/healthz` is unaffected — the compose healthcheck already reaches it over
loopback inside the container (`docker-compose.prod.yml:76`).

## 4. Change 2 — Internalize worker → Inngest

`INNGEST_BASE_URL` currently points at the public Inngest hostname, so both
event sends and the SDK's registration handshake (`/fn/register`) leave the
network. This is the exact path the Cloudflare Access bypass rule was written
for.

**Change:** set `INNGEST_BASE_URL=http://inngest:8288`.

Once Changes 1, 2 and 3 are in place, the Cloudflare Access carve-outs for
`/fn/register` and `/e/*` can be **removed**, not merely maintained.

## 5. Change 3 — Delete the Edge Function, emit from `pg_net`

`emit-investigation-requested` is a pure JSON reshaper: it maps
`{type, table, record.id}` to `{name, id, data.investigation_id}` and POSTs to
`${INNGEST_EVENT_URL}/e/${INNGEST_EVENT_KEY}`. Postgres can build that object
itself.

### 5.1 Preserving the "no secrets in migration SQL" constraint

The V1 design states the Inngest URL and event key must live "never in
migration SQL". **That constraint is preserved.** Both values remain operator
-set database settings, read at trigger time; the migration only calls
`current_setting(...)`. This is the pattern the trigger already uses for
`app.settings.emit_investigation_url` and `app.settings.emit_investigation_token`.

Settings after this change:

| Setting | Value |
|---|---|
| `app.settings.inngest_base_url` | `http://inngest:8288` |
| `app.settings.inngest_event_key` | the `INNGEST_EVENT_KEY` value |

Kept as two settings, not one pre-joined URL, so key rotation touches one
setting. The empty-URL no-op guard and the missing-`pg_net` guard both remain
unchanged — an unwired environment still inserts cleanly.

### 5.2 Testable seam

The Edge Function's logic is currently unit-tested through the pure function
`buildInngestEvent` (`event.test.ts`, two cases). The SQL port keeps that seam:

```sql
create function build_inngest_event(inv_id uuid) returns jsonb
```

returning `{"name": "investigation.requested", "id": <uuid>,
"data": {"investigation_id": <uuid>}}`. The trigger calls it; tests call it
directly. The two existing Deno assertions port across one-for-one, including
that the event `id` equals the investigation id — Inngest's idempotency key,
which `sweep_stale_queued_fn` already depends on for safe re-emission.

### 5.3 Deleted

- `supabase/functions/emit-investigation-requested/` (all three files)
- the `supabase secrets set INNGEST_EVENT_URL=... INNGEST_EVENT_KEY=...`
  post-deploy step in `.env.production.example`
- `INNGEST_EVENT_URL` as a concept
- the Edge Function as an independent release channel

### 5.4 Note on retry semantics

The Edge Function returns 502 on a failed Inngest POST, commented as "let the
invocation layer retry". **`pg_net` does not retry.** That contract is not
honored today, so no retry behavior is lost by removing it. The real backstop
is and remains `sweep_stale_queued_fn`, which re-emits stale `queued` rows on a
ten-minute cron.

## 6. Prerequisite: network reachability

Changes 2 and 3 assume the self-hosted Supabase Postgres container and the
Inngest container both resolve `inngest` / `api-worker` on the shared external
`coolify` network. **This is unverified and must be confirmed before
implementation.** Verification: from the Supabase Postgres container, resolve
and reach `http://inngest:8288`; from the Inngest container, reach
`http://api-worker:8000/api/inngest`.

Note that Coolify may register services under generated names rather than the
compose service name — the resolvable hostname must be read off the running
stack, not assumed.

**If they do not share a network:** Change 1 still applies unchanged (worker
and Inngest are both reachable to each other). Changes 2 and 3 fall back to the
public hostnames, retaining the Cloudflare Access carve-outs. Change 3 still
deletes the Edge Function — that win is independent of the network topology.

## 7. Syncing after deploy

With no public worker URL, app sync happens one of two ways, both unaffected by
this design:

- **Automatic:** the SDK advertises `INNGEST_SERVE_ORIGIN` on startup.
- **Manual:** the Inngest dashboard's "Sync new app" accepts a URL that is
  fetched by the **Inngest server**, not the browser — so
  `http://api-worker:8000/api/inngest` resolves correctly.

## 8. Testing

Per TDD, each change lands as a failing test first.

| Change | Test |
|---|---|
| 3 — event shape | `build_inngest_event` returns the exact Inngest event object; ports the two `event.test.ts` cases |
| 3 — trigger wiring | Verified end-to-end, not by SQL unit test: an INSERT into `investigations` must satisfy the quota trigger and RLS, so a unit test would fight the schema for little value. The unset-settings no-op is asserted directly; delivery is proven by a real submission |
| 1, 2 — config | Assert the worker resolves `serve_origin`/`base_url` from env rather than a hardcoded host |
| End-to-end | `scripts/smoke_e2e.md` run against the internal-only wiring |

**Harness decision:** there is no SQL test harness in the repo today — existing
tests are Python-side. This design adds one: a Python test module that runs the
SQL assertions against a local `supabase start` database, skipped when no
database is reachable so CI stays green without one. This is the smallest
harness that covers §5.2; introducing pgTAP is explicitly rejected as new
tooling for two assertions.

## 9. Rollback

Each change is independently revertible:

- **1, 2** — environment variables. Restore the public values and re-add the
  Traefik labels.
- **3** — a migration. The Edge Function is recoverable from git history; the
  previous trigger body restores by re-pointing `emit_investigation_url` at the
  Edge Function URL.

Nothing here alters the `investigations` schema, the graph, or any persisted
data, so rollback carries no data migration.

## 10. Out of scope

- Replacing Inngest with a pull-based engine (Procrastinate, Temporal). Rejected
  for this cycle: Inngest is retained by decision.
- V0 teardown (`apps/api/src/app/main.py` and the OpenAPI → `api-types`
  pipeline). Separate work, blocked on the web supabase-js migration.
- Coolify/Traefik label rationalization beyond the labels this design deletes.
