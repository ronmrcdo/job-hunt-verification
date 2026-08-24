# Inngest Loop Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four-hop investigation dispatch chain to two internal hops, delete the Supabase Edge Function, and document the resulting production system.

**Architecture:** Inngest is retained in full. The Edge Function is replaced by the `pg_net` trigger building the Inngest event directly in SQL; the executor callback and the worker→Inngest direction are repointed at Docker-internal DNS so no job traffic crosses the public internet.

**Tech Stack:** Postgres 15 + `pg_net`, Supabase migrations, Python 3.12 / psycopg3 / pytest, Inngest Python SDK 0.5.19, Docker Compose, Coolify + Traefik.

**Spec:** `docs/superpowers/specs/2026-08-24-inngest-loop-simplification-design.md`

## Global Constraints

- **Inngest is retained.** Do not replace it, do not add a polling loop. The pod, retry budget, `on_failure`, cron sweeper and dashboard all stay.
- **No secrets in migration SQL.** The Inngest base URL and event key are operator-set database settings; migrations only call `current_setting(...)`.
- **Settings names are fixed:** `app.settings.inngest_base_url`, `app.settings.inngest_event_key`. Two settings, never one pre-joined URL.
- **The event `id` must equal the investigation id.** It is Inngest's idempotency key and `sweep_stale_queued_fn` depends on it for safe re-emission.
- **Both existing guards survive:** unset settings are a clean no-op, and a missing `pg_net` raises a warning without aborting the INSERT.
- **`sweep_stale_queued_fn` is not modified.** It remains the delivery backstop.
- **The Inngest dashboard stays publicly routed** with its basic auth intact.
- No commit steps in this plan; commit on your own cadence.

---

### Task 1: Verify network reachability and fix the target hostnames

Blocking prerequisite (spec §6). Everything downstream depends on the answer. **This task is executed by the operator on the Coolify host, not in the repo.**

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-inngest-loop-simplification-design.md` (§6 — record the result)

- [ ] **Step 1: List what actually shares the network**

```bash
docker network inspect coolify --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}'
```

Record the real container names. Coolify frequently registers services under generated names (e.g. `api-worker-abc123`) rather than the compose service name. The names printed here are the hostnames to use everywhere below — do not assume `inngest` or `api-worker` resolve.

- [ ] **Step 2: Verify Inngest can reach the worker**

```bash
docker exec $(docker ps -qf name=inngest) wget -qO- http://<worker-name>:8000/healthz
```

Expected: `{"ok":true}`

- [ ] **Step 3: Verify Postgres can reach Inngest**

```bash
docker exec $(docker ps -qf name=supabase-db) getent hosts <inngest-name>
```

Expected: an IP address. Empty output means the Supabase stack is on a different network.

- [ ] **Step 4: Record the outcome in the spec**

Replace §6's "unverified" wording with the confirmed hostnames, or record which direction failed.

**Branch on the result:**
- **Both reachable** → proceed with all tasks as written, using the confirmed hostnames.
- **Step 3 fails** → Task 3 uses the public Inngest URL (`https://jobverifai-inngest.ronmrcdo.dev`) and the `/e/*` Cloudflare Access carve-out is retained. Task 3 still deletes the Edge Function; that win does not depend on the network.
- **Step 2 fails** → Task 4 skips `INNGEST_SERVE_ORIGIN` and keeps the worker's public route. Tasks 2, 3, 5, 6 are unaffected.

---

### Task 2: SQL test harness and `build_inngest_event`

Ports the Edge Function's pure seam (`event.ts::buildInngestEvent` and its two Deno tests) into SQL. Spec §5.2, §8.

**Files:**
- Create: `apps/api/tests/sql/__init__.py`
- Create: `apps/api/tests/sql/test_emit_event.py`
- Create: `supabase/migrations/20260824000000_build_inngest_event.sql`

**Interfaces:**
- Produces: SQL function `build_inngest_event(inv_id uuid) returns jsonb`, consumed by Task 3's trigger.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/sql/__init__.py` as an empty file, then `apps/api/tests/sql/test_emit_event.py`:

```python
"""SQL-level tests for the Inngest event builder (spec §5.2).

These need a real Postgres — they run against the local Supabase database and
skip when none is reachable, so CI stays green without one. Get the URL from
`supabase status` if the default port differs.
"""
import os

import psycopg
import pytest

DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)


@pytest.fixture(scope="module")
def conn():
    try:
        c = psycopg.connect(DB_URL, connect_timeout=2)
    except psycopg.OperationalError:
        pytest.skip("no local Supabase database reachable; run `supabase start`")
    yield c
    c.close()


def test_builds_investigation_requested_with_id_equal_to_row_id(conn):
    inv_id = "3f4b2c1a-0000-4000-8000-000000000001"
    with conn.cursor() as cur:
        cur.execute("SELECT build_inngest_event(%s::uuid)", (inv_id,))
        event = cur.fetchone()[0]
    conn.rollback()
    assert event == {
        "name": "investigation.requested",
        "id": inv_id,                      # idempotency key = investigation id
        "data": {"investigation_id": inv_id},
    }


def test_rejects_a_null_investigation_id(conn):
    with conn.cursor() as cur:
        with pytest.raises(psycopg.errors.RaiseException):
            cur.execute("SELECT build_inngest_event(NULL)")
    conn.rollback()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && uv run pytest tests/sql/test_emit_event.py -v`

Expected: FAIL with `UndefinedFunction: function build_inngest_event(uuid) does not exist`.

If it SKIPS, the database is not running — start it with `supabase start` first. A skip is not a passing test.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260824000000_build_inngest_event.sql`:

```sql
-- The Inngest event builder, ported from the deleted Edge Function's
-- `buildInngestEvent` (supabase/functions/emit-investigation-requested/event.ts).
-- Kept as its own function rather than inlined into the trigger so it stays
-- unit-testable — see apps/api/tests/sql/test_emit_event.py.
--
-- `id` is deliberately the investigation id: it is Inngest's idempotency key,
-- which sweep_stale_queued_fn relies on when it re-emits stale queued rows.

create or replace function build_inngest_event(inv_id uuid)
returns jsonb language plpgsql immutable as $$
begin
  if inv_id is null then
    raise exception 'build_inngest_event: investigation id is null';
  end if;
  return jsonb_build_object(
    'name', 'investigation.requested',
    'id', inv_id::text,
    'data', jsonb_build_object('investigation_id', inv_id::text)
  );
end $$;
```

- [ ] **Step 4: Apply the migration and re-run**

```bash
supabase db push --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
cd apps/api && uv run pytest tests/sql/test_emit_event.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Confirm the suite still runs without a database**

```bash
cd apps/api && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres uv run pytest tests/sql -v
```

Expected: 2 skipped, 0 failed. This is what CI will do.

---

### Task 3: Repoint the trigger at Inngest and delete the Edge Function

Spec §5. The trigger stops calling the Edge Function and posts the Inngest event itself.

**Files:**
- Create: `supabase/migrations/20260824000100_emit_direct_to_inngest.sql`
- Delete: `supabase/functions/emit-investigation-requested/index.ts`
- Delete: `supabase/functions/emit-investigation-requested/event.ts`
- Delete: `supabase/functions/emit-investigation-requested/event.test.ts`

**Interfaces:**
- Consumes: `build_inngest_event(uuid) returns jsonb` from Task 2.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260824000100_emit_direct_to_inngest.sql`:

```sql
-- Emit the Inngest event straight from pg_net; the Edge Function
-- `emit-investigation-requested` was a pure JSON reshaper and is deleted.
--
-- Secrets still never live in migration SQL: the base URL and event key are
-- operator-set database settings read at trigger time, exactly as the previous
-- app.settings.emit_investigation_url/_token were. Set them per environment:
--   alter database postgres set app.settings.inngest_base_url = 'http://inngest:8288';
--   alter database postgres set app.settings.inngest_event_key = '<INNGEST_EVENT_KEY>';
--
-- Two settings rather than one pre-joined URL so key rotation touches one value.
--
-- Both guards from 20260820010000 are preserved: unwired settings are a clean
-- no-op, and a missing pg_net warns instead of aborting the INSERT.
--
-- Note pg_net does NOT retry a failed POST. It never did — the Edge Function's
-- 502-so-the-caller-retries contract was not honored by pg_net either. The
-- delivery backstop is and remains sweep_stale_queued_fn (spec §6).

create or replace function emit_investigation_requested()
returns trigger language plpgsql as $$
declare
  base_url  text := current_setting('app.settings.inngest_base_url', true);
  event_key text := current_setting('app.settings.inngest_event_key', true);
begin
  if base_url is null or base_url = '' or event_key is null or event_key = '' then
    return new;  -- not wired in this environment: no-op, never block the insert.
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise warning
      'emit_investigation_requested: pg_net (net schema) absent; skipping emission for investigation %. Run: create extension if not exists pg_net;',
      new.id;
    return new;
  end if;

  perform net.http_post(
    url     := rtrim(base_url, '/') || '/e/' || event_key,
    body    := build_inngest_event(new.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
end $$;
```

The `trg_emit_requested` trigger itself is unchanged — `create or replace function` rebinds it automatically.

- [ ] **Step 2: Apply and verify the no-op guard still holds**

```bash
supabase db push --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "select current_setting('app.settings.inngest_base_url', true) is null as unwired;"
```

Expected: `unwired = t` on a fresh local database, meaning inserts proceed without emission.

- [ ] **Step 3: Delete the Edge Function**

```bash
rm -rf supabase/functions/emit-investigation-requested
```

Its two Deno assertions now live in `apps/api/tests/sql/test_emit_event.py` from Task 2 — verify both are represented before deleting, so no coverage is lost.

- [ ] **Step 4: Remove the Edge Function from local wiring docs**

In `scripts/RUNBOOK.md`, replace §4a/§4b/§4c (`Local webhook wiring`, `Confirm delivery`, `Local secrets`) with the two `alter database ... set app.settings.inngest_*` statements. The service_role JWT bearer and the `supabase secrets set` instructions are obsolete — delete them rather than leaving them alongside the new wiring.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/api && uv run pytest -q`

Expected: PASS, with the `tests/sql` module either passing or skipping.

---

### Task 4: Internalize both hops

Spec §3 and §4. Configuration only — `INNGEST_*` is read by the SDK straight from the environment (never through `app.config.Settings`), so there is no Python change and no unit test here. Verification is Task 5.

**Files:**
- Modify: `docker-compose.prod.yml` (worker `environment` and `labels`)
- Modify: `.env.production.example`

- [ ] **Step 1: Add the serve origin and repoint the base URL**

In `docker-compose.prod.yml`, in the `api-worker` `environment` block, replace the `INNGEST_BASE_URL` line and add `INNGEST_SERVE_ORIGIN`, using the hostnames confirmed in Task 1:

```yaml
      # Both directions stay inside the shared coolify network — no job traffic
      # crosses the public internet. Mirrors what dev has always done
      # (docker-compose.yml: `inngest dev -u http://api-worker:8000/api/inngest`).
      INNGEST_BASE_URL: ${INNGEST_BASE_URL:-http://inngest:8288}
      # The URL the SDK advertises during app sync — where Inngest calls back.
      # Read by the SDK from env (inngest/_internal/config_lib.py).
      INNGEST_SERVE_ORIGIN: ${INNGEST_SERVE_ORIGIN:-http://api-worker:8000}
```

- [ ] **Step 2: Delete the worker's public route**

Remove the entire `labels:` block from the `api-worker` service in `docker-compose.prod.yml` (the three `traefik.*` lines). The worker has no human-facing surface — only `/healthz` and the machine-to-machine `/api/inngest` — and `/healthz` is reached over loopback by the existing healthcheck.

Leave the `web` and Inngest routes untouched.

- [ ] **Step 3: Update the environment template**

In `.env.production.example`:
- delete `WORKER_HOST`
- delete the whole "Post-deploy: point the Supabase edge function at production Inngest" block at the end
- replace the `INNGEST_HOST` comment to note it now serves only the dashboard
- add the two new settings with the values from Task 1

```bash
# ── Inngest ─────────────────────────────────────────────────────────────────
# Internal Docker DNS on the shared coolify network. No job traffic leaves the
# network; only the dashboard (INNGEST_HOST) is publicly routed.
INNGEST_BASE_URL=http://inngest:8288
INNGEST_SERVE_ORIGIN=http://api-worker:8000

# ── Database settings, applied once per environment ─────────────────────────
# The emit trigger reads these; they are NOT compose env vars.
#   alter database postgres set app.settings.inngest_base_url = 'http://inngest:8288';
#   alter database postgres set app.settings.inngest_event_key = '<INNGEST_EVENT_KEY>';
```

- [ ] **Step 4: Confirm compose still parses**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config >/dev/null && echo OK
```

Expected: `OK`. A missing required var fails loudly here rather than at deploy.

---

### Task 5: Deploy and verify end to end

Spec §7, §8. This is where Tasks 3 and 4 are actually proven.

**Files:**
- Modify: `scripts/smoke_e2e.md` (add the production internal-wiring check)

- [ ] **Step 1: Apply the database settings in production**

```bash
psql "$DATABASE_URL" -c "alter database postgres set app.settings.inngest_base_url = 'http://inngest:8288';"
psql "$DATABASE_URL" -c "alter database postgres set app.settings.inngest_event_key = '<INNGEST_EVENT_KEY>';"
```

These are `alter database` settings — existing sessions keep the old values, so bounce the Postgres connections or restart the stack before testing.

- [ ] **Step 2: Deploy and confirm app sync**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Then open the Inngest dashboard and confirm the `job-hunt-verification` app is synced and lists both `run-investigation` and `sweep-stale-queued`. If it is not, use "Sync new app" with `http://api-worker:8000/api/inngest` — that URL is fetched by the Inngest server, not your browser, so internal DNS resolves correctly.

- [ ] **Step 3: Submit a real investigation**

Submit through the web UI and watch the row transition `queued → running → done`, with `investigation_steps` populating. This exercises the full chain: INSERT → trigger → `pg_net` → Inngest → internal callback → graph run.

- [ ] **Step 4: Confirm no public hostname is required**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://jobverifai-worker.ronmrcdo.dev/healthz
```

Expected: a failure or 404 — the route is gone. Investigations must still run. If they stop, the callback is not resolving internally; revert Step 1 of Task 4 and re-check Task 1 Step 2.

- [ ] **Step 5: Remove the Cloudflare Access carve-outs**

Once investigations run end-to-end, delete the bypass rules for `/fn/register` and `/e/*` on the Inngest host, and the worker's Access rule entirely. Re-run Step 3 afterwards to confirm nothing depended on them.

- [ ] **Step 6: Record the verification in the smoke test**

Add a short production section to `scripts/smoke_e2e.md` covering Steps 2–4, so the next deploy has a repeatable check.

---

### Task 6: Write the production documentation

The deliverable requested alongside this work. It is written **last, describing what is actually deployed** — after Task 5 proves the system runs — rather than a runbook for a state production is not in.

**Files:**
- Create: `docs/PRODUCTION.md`
- Modify: `README.md` (link it from `## System architecture`)

- [ ] **Step 1: Write `docs/PRODUCTION.md`**

There is currently no production documentation in the repo — `scripts/RUNBOOK.md` is local-only, `smoke_e2e.md` is a local smoke test. Cover, in this order:

1. **Topology** — the four deployed units (web, api-worker, Inngest pod, self-hosted Supabase), which are publicly routed (web, Inngest dashboard only) and which are internal-only (api-worker), on the shared external `coolify` network.
2. **Dispatch chain** — the two-hop diagram from spec §1, with the note that no job traffic leaves the Docker network.
3. **Configuration** — every production variable, where it is set (compose file / Coolify UI / database setting), and which are secrets. Call out that `NEXT_PUBLIC_*` are build-time and need `up -d --build`, not a restart.
4. **Deploying** — the `up -d --build` command, and applying migrations via `supabase db push` against `DATABASE_URL`.
5. **Operating** — where to look when a run fails: the Inngest dashboard, then `investigations` / `investigation_steps`. How app sync works and how to re-sync.
6. **Known operational gotchas** — carry these across from the compose comments and hard-won experience so they stop living in one person's head:
   - Coolify does not expand `${VAR:-default}` inside Traefik labels; hardcode the domain and router hash.
   - Coolify injects UI-set environment into containers, which can shadow compose values.
   - The Inngest signing key must be plain even-length hex; a `signkey-` prefix is rejected.
   - `INNGEST_BASICAUTH_USERS` bcrypt hashes must not have their `$` doubled.
   - `pg_net` can be dropped by a local stop/start; the emit trigger warns rather than aborting the INSERT.
   - The checkpointer schema is transcribed by hand and must be regenerated on a `langgraph-checkpoint-postgres` bump.
7. **Rollback** — per spec §9: Tasks 4's changes are environment variables; Task 3 is a migration with the Edge Function recoverable from git history. No data migration is involved.

- [ ] **Step 2: Verify every command in the doc**

Run each command in the deploy and operate sections against production. A production runbook containing an untested command is worse than none — fix anything that does not work as written before finishing.

- [ ] **Step 3: Link it**

Add a line under `## System architecture` in `README.md` pointing to `docs/PRODUCTION.md` for deployment and operations, so it is discoverable from the entry point.

- [ ] **Step 4: Strip the compose comments**

Only after Steps 1-3 are complete and `docs/PRODUCTION.md` demonstrably contains the operational knowledge listed in Step 1 item 6.

`docker-compose.yml` is 46% comments and `docker-compose.prod.yml` is 39%. Reduce both to configuration: delete the explanatory header blocks and the prose comments whose content now lives in `docs/PRODUCTION.md`.

Before deleting any comment, confirm its content appears in `docs/PRODUCTION.md`. If it does not, either add it there or keep the comment — the point of the sequencing is that nothing is lost. Keep comments that would prevent a direct editing mistake at the line they annotate (for example, that `NEXT_PUBLIC_*` are build-time args, not runtime env).

Verify after editing:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config >/dev/null && echo OK
docker compose -f docker-compose.yml config >/dev/null && echo OK
```

Both must print `OK` — a comment strip must not change how either file parses.
