# Runbook: applying the V1 migrations & verifying RLS

Operator-run only. **None of the steps below are run by the implementation
task** — the Global Constraint forbids the implementation from starting a
database, applying migrations, or connecting to Postgres. This document is
how Ron (the operator) runs everything after the migration files are
authored.

Migrations covered:
- `supabase/migrations/20260819073420_investigations_v1.sql`
- `supabase/migrations/20260819073430_langgraph_checkpointer.sql`
- `supabase/migrations/20260819080000_investigations_sources.sql`

Verification script: `scripts/verify_rls.sql`

## 0. Prerequisites

- Supabase CLI installed and logged in (for a hosted project) or just
  installed (for local dev).
- Docker running, for `supabase start`.
- Repo root as working directory.

## 1. Start the local stack

```bash
supabase start
```

This brings up local Postgres/Auth/Realtime/Storage/Functions. Note the
printed `DB URL`, `anon key`, and `service_role key` — you'll need the DB
URL for steps 3-4.

If this is the very first run against a fresh project, the V0
`investigations` table (created by the Python app's `init_tables()`
DDL-on-startup) needs to already exist before
`20260819073420_investigations_v1.sql` runs, since that migration does
`ALTER TABLE investigations ...` rather than `CREATE TABLE`. If migrating a
genuinely fresh database that never ran the V0 app, create a minimal
`investigations` table matching the V0 shape first (id uuid pk, owner_key
text, status text, submission/assessment/findings/cost/what_to_verify
jsonb, created_at timestamptz) or adjust the migration to `CREATE TABLE IF
NOT EXISTS` — this is a one-time bootstrapping decision for the operator,
not something the migration file should special-case.

## 2. Apply the migrations

```bash
supabase migration up
```

or, for a hosted project:

```bash
supabase db push
```

This applies both migration files in filename order (the
`investigations_v1` migration, then the `langgraph_checkpointer`
migration). Confirm no errors.

**Note:** `20260819073420_investigations_v1.sql` starts with `delete from
investigations;` — by design (spec §1/§11 clean break), this deletes ALL
pre-existing rows in `investigations` before adding the `user_id` column,
since V0 rows have no owner and V1 requires `user_id` to be non-null.

## 3. Run the RLS/CHECK verification script

Run it inside a transaction that gets rolled back — the script itself
issues `begin;` / `rollback;`, so it leaves no residue on success or
failure:

```bash
psql "$(supabase status -o json | jq -r '.DB_URL')" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql
```

(Swap in the printed local `DB URL` directly if `jq`/`-o json` isn't
available, or use the hosted project's connection string for a staging
verification.)

Expected output: a `NOTICE` line for each of cases 1-5 and case 7 ending in
`OK`, and no `ERROR`. Any `CASE N FAILED` exception means the corresponding
migration step needs fixing before this V1 schema is safe to build on.
Case 7 covers the `sources` column added by
`20260819080000_investigations_sources.sql` — apply that migration
(after the two listed above) before running the script.

If `investigations.user_id` has a live FK to `auth.users(id)` and the
target database enforces it strictly, first insert two throwaway
`auth.users` rows with the UUIDs the script uses
(`11111111-1111-1111-1111-111111111111`,
`22222222-2222-2222-2222-222222222222`) — e.g. via the Auth Admin API or
`supabase auth admin` tooling — before running the script, then remove them
afterward. A local `supabase start` stack with FK enforcement relaxed for
seed data does not need this.

## 4. Wire and confirm the Edge Function invocation (webhook)

`AFTER INSERT on investigations` fires the trigger
`trg_emit_requested → emit_investigation_requested()`, which calls the
Edge Function `emit-investigation-requested` via **pg_net**
(`net.http_post`). The endpoint URL and its auth token are **not** baked
into the migration — the trigger reads them at run time from two database
settings, and is a deliberate **no-op when the URL setting is unset** (so a
fresh `supabase db reset` inserts cleanly instead of failing the INSERT on
a webhook error). You wire them per environment before inserts should emit.

> **Prerequisite — pg_net:** `net.http_post` requires the `pg_net`
> extension. The `investigations_v1` migration enables it
> (`create extension if not exists pg_net`), so a migrated DB already has
> it. Wiring the URL below on a DB where pg_net is *absent* flips the
> trigger from no-op to active and every INSERT then aborts with
> `schema "net" does not exist` — if you see that, your DB predates the
> migration; re-run `supabase db reset` (or `create extension pg_net`).

### 4a. Local webhook wiring

From the DB container / a superuser connection (locally the superuser role
is `supabase_admin`; the `postgres` role is not permitted to set these
parameters on the local stack):

```bash
DB=supabase_db_<project>   # e.g. supabase_db_job-hunt-verification
# Local service_role JWT (used as the function's Authorization bearer):
SRK=$(docker exec supabase_edge_runtime_<project> \
        printenv SUPABASE_SERVICE_ROLE_KEY)

docker exec -i "$DB" psql -U supabase_admin -d postgres <<SQL
alter database postgres
  set app.settings.emit_investigation_url =
      'http://kong:8000/functions/v1/emit-investigation-requested';
alter database postgres
  set app.settings.emit_investigation_token = '$SRK';
SQL
```

`kong:8000` is the gateway's in-network alias — the URL must be reachable
**from inside the Postgres container**, so `127.0.0.1:54321` (a host
address) will NOT work; use the `kong` alias. Settings take effect on new
connections. The token is set only on the live local DB, never committed.

**Hosted:** set the same two settings to the project's functions endpoint
(`https://<ref>.functions.supabase.co/emit-investigation-requested`) and a
service_role JWT. Prefer sourcing the token from **Supabase Vault** rather
than a plaintext GUC; if you keep the built-in Database-Webhook UI instead,
point an AFTER INSERT webhook at the same function — the trigger's no-op
guard means an unset URL simply skips emission.

### 4b. Confirm delivery

1. Insert a real row as an authenticated user (via the app, or `psql` with
   `set local role authenticated` + `request.jwt.claims`, **and COMMIT** —
   pg_net only dispatches after the transaction commits).
2. Read the async result pg_net recorded:
   ```bash
   docker exec -i "$DB" psql -U postgres -d postgres \
     -c "select status_code, content from net._http_response order by id desc limit 1;"
   ```
   - `500 missing inngest config` → **wiring is correct**; the function ran
     and only lacks its Inngest secrets (set `INNGEST_EVENT_URL` /
     `INNGEST_EVENT_KEY` via `supabase secrets set` and run an Inngest dev
     server for a full end-to-end event, per §8: the Inngest event `id`
     must equal the investigation id).
   - `401` → auth token missing/wrong. Connection error / NULL row → URL
     unreachable from the DB container, or the URL setting is unset.
3. Or tail the function logs directly:
   ```bash
   supabase functions logs emit-investigation-requested
   ```

### 4c. Local secrets — the two gaps that keep runs from firing

Even with §4a wired, a fresh local stack has **two unset secrets** that
silently stop the pipeline. The symptom is: investigations INSERT fine and
the detail page loads, but the Inngest dashboard shows only the
`sweep-stale-queued` cron — `run-investigation` never appears — and the
case sits at `queued` forever. Both are secrets, kept out of git by design;
wire them locally as below.

**Gap 1 — Edge Function → Inngest (`500 missing inngest config`).** The
`emit-investigation-requested` function POSTs to
`${INNGEST_EVENT_URL}/e/${INNGEST_EVENT_KEY}`; with those unset it returns
500 and no event is emitted (this is exactly the §4b `500` case). Locally
these come from `[edge_runtime.secrets]` in `supabase/config.toml`, which
resolves them via `env()` from `supabase/.env` (gitignored):

```bash
# supabase/.env
INNGEST_EVENT_URL=http://host.docker.internal:8288   # Inngest dev server on the host
INNGEST_EVENT_KEY=local-dev                          # dev server accepts any key
```

`host.docker.internal:8288` (not `localhost`) because the URL must resolve
from *inside the edge runtime container* — it reaches the host-published
Inngest port that way. Apply with `supabase stop && supabase start` (edge
secrets are read at container start, not hot-reloaded). Confirm the §4b
response flips from `500` to `202`.

**Gotcha — `supabase stop/start` drops pg_net (`schema "net" does not exist`).**
On the local stack a restart preserves the migration history AND the db-level
`app.settings.emit_investigation_url` GUC (it lives in `pg_db_role_setting`),
but does NOT preserve the `pg_net` extension — the `net` schema is gone.
Because `investigations_v1` is already marked applied, its
`create extension if not exists pg_net` never re-runs, so the URL setting and
`net` diverge and the emit trigger aborts EVERY check insert with
`ERROR: schema "net" does not exist` ("We couldn't start the check.").
Migration `20260820010000_emit_requested_guard_pg_net.sql` hardens the trigger
to no-op (with a `WARNING`) when `net` is absent, so a restart can no longer
break inserts — apply it once with `supabase migration up`. To restore
*automatic* emission after such a restart, re-create the extension:

```bash
docker exec -i "$DB" psql -U postgres -d postgres -c "create extension if not exists pg_net;"
```

**Gap 2 — Worker → OpenAI (`openai.OpenAIError: Missing credentials`).**
Once an event fires, `run-investigation` starts and the graph crashes at
the `intake` node if the worker has no model key. `OPENAI_API_KEY` (and
`TAVILY_API_KEY`) are read from the **root `.env`** by docker-compose's
`x-api-env`. Set a real key and recreate the worker so it picks up the env:

```bash
# root .env
OPENAI_API_KEY=sk-...
```
```bash
docker compose up -d --force-recreate api-worker
```

**Quick end-to-end sanity check without the app** (also un-sticks a queued
row): the Inngest event `id` MUST equal the investigation id (§8 idempotency).

```bash
curl -s -X POST "http://localhost:8288/e/local-dev" \
  -H "Content-Type: application/json" \
  -d '{"name":"investigation.requested","id":"<INV_ID>","data":{"investigation_id":"<INV_ID>"}}'
# then watch the row go queued -> running and steps populate:
docker exec -i "$DB" psql -U postgres -d postgres \
  -c "select step_key, status from investigation_steps where investigation_id='<INV_ID>' order by display_order;"
```

## 5. Checkpointer schema regeneration (on version bump)

`supabase/migrations/20260819073430_langgraph_checkpointer.sql` was
transcribed from `langgraph-checkpoint-postgres` 3.1.2's `MIGRATIONS` list
(see the file's header comment for the exact source path). Whenever
`apps/api/pyproject.toml`'s pin on `langgraph-checkpoint-postgres` moves
past the range this file was written against:

1. In a throwaway environment (a scratch local Postgres, not this repo's
   dev stack), install the new package version and call
   `AsyncPostgresSaver.setup()` against it directly.
2. Dump the resulting schema (`pg_dump --schema-only` scoped to the four
   checkpoint tables, or `\d checkpoint_migrations checkpoints
   checkpoint_blobs checkpoint_writes` in `psql`).
3. Diff that output against `20260819073430_langgraph_checkpointer.sql`.
4. Author a **new** migration file with the delta (never hand-edit this
   file after it has been applied anywhere) and update its header comment
   with the new pinned version and transcription source.

Never hand-write or guess this DDL from memory — always transcribe from
the installed package's own migration source or a real `setup()` dump.

## 6. Disposable email signup block and auth configuration

**Supabase Auth settings** (project > Settings > Auth > Providers):
1. Enable **"Confirm email"** (toggle ON). Unconfirmed users never receive an authenticated session and cannot insert investigations, providing an additional barrier against disposable-email account farms.
2. Enable **Google OAuth** as the higher-trust sign-up path. OAuth-backed accounts bypass disposable-email checks (the email is pre-verified by Google), reducing signup friction for trusted users while keeping disposable-email abuse cheap.

**Refresh the disposable domains seed list** when new disposable-email services emerge (best practice: quarterly or when abuse patterns spike):

```sql
-- On a local/staging database:
delete from blocked_email_domains;
insert into blocked_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('10minutemail.com'),
  ('tempmail.com'), ('trashmail.com'), ('yopmail.com'), ('getnada.com'),
  ('dispostable.com'), ('maildrop.cc'), ('sharklasers.com'),
  -- Add new domains here as needed
  ('domain.example')
on conflict do nothing;
```

For hosted Supabase, run this via the SQL Editor or a Postgres client connected to the project database.

## 7. Local LLM (offline / no-OpenAI dev)

An alternative to §4c Gap 2's real `OPENAI_API_KEY`: run an
OpenAI-compatible model locally and point the worker at it. The
`llama` service in `docker-compose.yml` runs `llama-server`
(llama.cpp), exposing `/v1/chat/completions`; the Python services reach it
in-network at `http://llama:8080/v1`. Nothing in the app code changes — only
`OPENAI_BASE_URL` and the model ids.

The service is gated behind the `llm` compose **profile**, so a plain
`docker compose up` neither pulls the image nor downloads a model. It only
starts when you pass `--profile llm`.

### 7a. Bring it up

Set these in the **root `.env`**, then start with the profile:

```bash
# root .env
OPENAI_BASE_URL=http://llama:8080/v1
CHEAP_MODEL=Qwen2.5-7B-Instruct-Q4_K_M
STRONG_MODEL=Qwen2.5-7B-Instruct-Q4_K_M
# Optional overrides (defaults shown):
# LLAMA_HF_REPO=bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M
# LLAMA_CTX=16384
```
```bash
docker compose --profile llm up -d
```

On **first** boot `-hf` downloads the GGUF from Hugging Face into the
`llama-models` named volume (cached for later runs); the container's
`/health` stays red until that finishes (a 300s `start_period` covers it).
Watch progress with `docker compose logs -f llama`.

`OPENAI_API_KEY` may be left empty in this mode — llama-server ignores the
bearer token. If you already had the worker running against real OpenAI,
recreate it so it picks up the new env: `docker compose up -d
--force-recreate api-worker`.

### 7b. Confirm it's serving

```bash
# from the host (llama publishes on :8081; container port is :8080):
curl -s http://localhost:8081/v1/models | jq '.data[].id'
curl -s http://localhost:8081/health
```

Then run an investigation end-to-end (§4c quick check). The graph's LLM
nodes now hit the local model; `net._http_response` / Inngest behaviour is
unchanged.

### 7c. Gotchas

- **`reasoning_effort` is a no-op.** The worker sends
  `CHEAP_/STRONG_REASONING_EFFORT` on every call; llama.cpp ignores unknown
  params, so those settings do nothing locally.
- **Structured output.** `structured_call` uses
  `method="json_schema", strict=True`; llama.cpp enforces this via a GBNF
  grammar, so it holds up well — but a small quant may still occasionally
  fail the two-attempt parse (`StructuredCallError`). Bump the model/quant
  (`LLAMA_HF_REPO`) if a node parses unreliably.
- **Model id is loose.** llama-server serves whatever single model is
  loaded regardless of the request's `model` field, so `CHEAP_MODEL` /
  `STRONG_MODEL` need only be non-empty — they don't have to match the
  served id exactly (the cost tracker keys pricing off the string, though).
- **GPU.** The default image is CPU-only. For CUDA, swap the image to
  `ghcr.io/ggml-org/llama.cpp:server-cuda` and add a `deploy.resources`
  GPU reservation to the `llama` service.

## Summary

None of steps 1-6 above were executed as part of authoring the migration
files, the verification script, or this runbook. They are provided so the
operator can apply and verify everything manually.
