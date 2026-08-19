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

## Summary

None of steps 1-5 above were executed as part of authoring the migration
files, the verification script, or this runbook. They are provided so the
operator can apply and verify everything manually.
