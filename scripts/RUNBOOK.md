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

## 4. Wire and confirm the direct-to-Inngest emission

`AFTER INSERT on investigations` fires the trigger
`trg_emit_requested → emit_investigation_requested()`, which POSTs the
Inngest event straight from **pg_net** (`net.http_post`) — there is no
Edge Function in the path. The base URL and event key are **not** baked
into the migration — the trigger reads them at run time from two database
settings, and is a deliberate **no-op when either setting is unset** (so a
fresh `supabase db reset` inserts cleanly instead of failing the INSERT
before Inngest is wired). You wire them per environment before inserts
should emit.

> **Prerequisite — pg_net:** `net.http_post` requires the `pg_net`
> extension. The `investigations_v1` migration enables it
> (`create extension if not exists pg_net`), so a migrated DB already has
> it. Wiring the settings below on a DB where pg_net is *absent* flips the
> trigger from no-op to active and every INSERT then aborts with
> `schema "net" does not exist` — if you see that, your DB predates the
> migration; re-run `supabase db reset` (or `create extension pg_net`).

### 4a. Local wiring

From the DB container / a superuser connection (locally the superuser role
is `supabase_admin`; the `postgres` role is not permitted to set these
parameters on the local stack):

```bash
DB=supabase_db_<project>   # e.g. supabase_db_job-hunt-verification

docker exec -i "$DB" psql -U supabase_admin -d postgres <<SQL
alter database postgres
  set app.settings.inngest_base_url = 'http://host.docker.internal:8288';
alter database postgres
  set app.settings.inngest_event_key = 'local-dev';
SQL
```

`host.docker.internal:8288` (not `localhost`) because the URL must resolve
**from inside the Postgres container** — it reaches the host-published
Inngest dev server port that way. The dev server accepts any non-empty
event key. Settings take effect on new connections.

**Hosted:** set the same two settings to the self-hosted Inngest instance's
base URL and its real event key. Two settings rather than one pre-joined
URL so key rotation touches one value; prefer sourcing the key from
**Supabase Vault** rather than a plaintext GUC where that's available.

### 4b. Confirm delivery

1. Insert a real row as an authenticated user (via the app, or `psql` with
   `set local role authenticated` + `request.jwt.claims`, **and COMMIT** —
   pg_net only dispatches after the transaction commits).
2. Read the async result pg_net recorded:
   ```bash
   docker exec -i "$DB" psql -U postgres -d postgres \
     -c "select status_code, content from net._http_response order by id desc limit 1;"
   ```
   - `200` → wiring is correct; check the Inngest dashboard for
     `run-investigation` (per §8: the Inngest event `id` must equal the
     investigation id).
   - Connection error / NULL row → URL unreachable from the DB container,
     or the settings are unset (no `net._http_response` row is written at
     all in that case — the trigger no-op'd before calling `net.http_post`).
3. Or watch the Inngest dashboard directly for the incoming event.

### 4c. Gotchas

**`supabase stop/start` drops pg_net (`schema "net" does not exist`).**
On the local stack a restart preserves the migration history AND the
db-level `app.settings.inngest_base_url` / `app.settings.inngest_event_key` GUCs (they
live in `pg_db_role_setting`), but does NOT preserve the `pg_net`
extension — the `net` schema is gone. Because `investigations_v1` is
already marked applied, its `create extension if not exists pg_net` never
re-runs, so the settings and `net` diverge and the emit trigger would abort
EVERY check insert with `ERROR: schema "net" does not exist`
("We couldn't start the check.") if left unguarded. Migration
`20260820010000_emit_requested_guard_pg_net.sql` hardens the trigger to
no-op (with a `WARNING`) when `net` is absent, so a restart can no longer
break inserts — apply it once with `supabase migration up`. To restore
*automatic* emission after such a restart, re-create the extension:

```bash
docker exec -i "$DB" psql -U postgres -d postgres -c "create extension if not exists pg_net;"
```

**Worker → OpenAI (`openai.OpenAIError: Missing credentials`).**
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

**Local dev note.** `supabase/config.toml` now sets `[auth.email]
enable_confirmations = true` (dev-parity with the hardened production
posture), so local sign-ups also require confirming email before the first
sign-in works. This does **not** break the local flow — `[auth.email.smtp]`
already points at MailHog (`host.docker.internal:1025`), so confirmation
emails land in the MailHog inbox UI at `http://localhost:8025` instead of a
real mailbox; open the confirmation link from there to complete sign-up.
`[auth.captcha]` is also enabled with `provider = "turnstile"` and
`secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"` — set `SUPABASE_AUTH_CAPTCHA_SECRET`
before `supabase start`, or the CLI fails to resolve the `env(...)` reference.
For local dev use Cloudflare's always-pass **test** secret key
`1x0000000000000000000000000000000AA` (NOT an arbitrary dummy — GoTrue verifies
the token against this secret, and a dummy would reject the always-pass test
token the front end's test site key `1x00000000000000000000AA` produces, so
sign-in would fail). The front end reads its site key from
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (see apps/web/.env.example); the widget lives in
`components/auth/AuthForm.tsx` and passes the token to Supabase auth. In
production, set your real Cloudflare site/secret keys instead.

**Supabase Auth settings** (project > Settings > Auth > Providers):
1. Enable **"Confirm email"** (toggle ON). Unconfirmed users never receive an authenticated session and cannot insert investigations, providing an additional barrier against disposable-email account farms.
2. Enable **Google OAuth** as the higher-trust sign-up path. In practice a Google sign-up carries a Google-domain (or workspace) email, which is not on the disposable list, so it passes the block; the block is not skipped for OAuth — the `before insert on auth.users` trigger has no provider carve-out and fires for every insert path (email, OAuth, and admin/service-role user creation alike).

**How the block surfaces to the user (important).** The `reject_disposable_email()` trigger raises `PT422`/`email_domain_not_allowed`, but sign-ups go through **GoTrue (the Auth API), not PostgREST**, so the `PTxyz`→HTTP-status mapping does **not** apply. GoTrue wraps a trigger error as a generic signup failure (typically HTTP 500 "Database error saving new user"), and the account is **not** created. The account-farm defense (no verified account, no `auth.uid()`, no checks) holds either way, but the client cannot currently show the specific "use a permanent email" copy purely from the response. If that precise UX is required later, add a **pre-signup check** (an Edge Function or an RPC the sign-up form calls before `signUp`) that reads `blocked_email_domains` and returns a clean 422 — the trigger stays as the authoritative backstop. The web sign-up form should treat a generic signup error defensively and suggest using a permanent (non-disposable) email.

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

## 8. Quota settings & top-ups (app_settings)

The quota knobs live in the `app_settings` table (not GUCs, not .env — the DB
trigger cannot read the web env). Edit them live, no deploy:

```sql
update app_settings set value = '5' where key = 'check_quota_limit';        -- weekly allowance
update app_settings set value = '7' where key = 'check_quota_window_days';  -- rolling window
update app_settings set value = '3' where key = 'default_top_up_balance';   -- bonus for NEW signups
```

`default_top_up_balance` applies to accounts created *after* the change; it does
not rewrite existing balances.

Grant (or claw back) bonus checks for one account as `service_role`:

```sql
select grant_top_up('<user-uuid>', 10);   -- add 10 bonus checks; returns new balance
select grant_top_up('<user-uuid>', -5);   -- claw back 5 (raises if it would go below 0)
```

Bonus checks never refresh; they are spent only after the weekly allowance is
used up.

## Summary

None of steps 1-6 above were executed as part of authoring the migration
files, the verification script, or this runbook. They are provided so the
operator can apply and verify everything manually.
