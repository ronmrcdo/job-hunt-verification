-- supabase/migrations/20260819073420_investigations_v1.sql
-- Implements spec §4 (Auth & RLS) and §5 (Schema & progress emission) of
-- docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md.
-- Reshapes the V0 `investigations` table (previously created by
-- `init_tables()` DDL-on-startup: id uuid pk, owner_key text, status text
-- default 'running', submission/assessment/findings/cost/what_to_verify
-- jsonb, created_at) into the V1 Supabase-first, RLS-gated shape.

-- Establish the V0 baseline so this migration is self-sufficient on a clean
-- Supabase database. In V0 the table was created at runtime by the Python API's
-- `init_tables()` DDL (apps/api/src/app/db.py); `supabase start` applies
-- migrations against a fresh DB where that never runs, so the ALTERs below have
-- nothing to reshape. This mirrors that V0 shape exactly and is a no-op when a
-- real V0 table already exists (idempotent `if not exists`).
create table if not exists investigations (
  id uuid primary key,
  owner_key text not null,
  status text not null default 'running',
  submission jsonb not null,
  assessment jsonb,
  findings jsonb,
  cost jsonb,
  what_to_verify jsonb,
  created_at timestamptz not null default now()
);

-- Spec §1/§11 clean break: V0 anonymous rows are dropped; V1 requires user_id (auth.uid()).
delete from investigations;

-- ---------------------------------------------------------------------------
-- investigations: drop the V0 shared-secret column, add real ownership,
-- reset the default lifecycle status, and add the dedupe-hit counter.
-- ---------------------------------------------------------------------------
alter table investigations drop column if exists owner_key;
alter table investigations add column user_id uuid not null default auth.uid()
  references auth.users(id);
alter table investigations alter column status set default 'queued';
alter table investigations add column if not exists check_count int;

-- The V1 client inserts only `submission` (spec §4) and never supplies an id —
-- V0's init_tables() left `id uuid primary key` with NO default because the
-- Python app generated the uuid in code. Give the DB the default so a
-- client-direct PostgREST insert can omit it. `alter column` (not the no-op
-- `create table if not exists` above) is what actually reshapes the live table.
-- gen_random_uuid() is core in Postgres 13+ (no pgcrypto extension needed).
alter table investigations alter column id set default gen_random_uuid();

alter table investigations add constraint investigations_status_chk
  check (status in ('queued','running','done','failed','deadline_exceeded'));

-- gap #4: presence AND length — a NULL char_length passes a CHECK, so a
-- submission missing `job_text` entirely must be rejected explicitly.
-- Cap of 40000 mirrors settings.max_job_text_chars (apps/api/src/app/config.py).
alter table investigations add constraint investigations_job_text_chk
  check (
    submission ? 'job_text'
    and char_length(submission->>'job_text') between 1 and 40000
  );

-- ---------------------------------------------------------------------------
-- investigation_steps: new table, denormalized checklist rows so the
-- frontend renders entirely from data (no hardcoded step names/order).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RLS (spec §4): client insert/select own rows only; no client
-- update/delete on either table, and no client writes on
-- investigation_steps at all (worker/service-role only).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Table-level GRANTs (spec §4). RLS decides WHICH rows; a role still needs a
-- base-table privilege or every statement fails with "permission denied for
-- table ...". Supabase's implicit default-privilege grant never reached this
-- table because it pre-existed from V0's runtime init_tables() DDL, so the
-- `create table if not exists` above was a no-op and no DML grant was ever
-- attached (authenticated held only Dxtm). Grant exactly what the RLS policies
-- allow: authenticated may insert + select its own investigations and read the
-- steps of its own investigations. No update/delete (no such policies); no anon
-- (RLS is authenticated-only and the routes are auth-gated); investigation_steps
-- stays worker-write-only (service role bypasses RLS + grants).
grant select, insert on investigations to authenticated;
grant select on investigation_steps to authenticated;

-- Force server-set columns regardless of client input (spec §4): a client
-- may only ever populate `submission` on insert; status and every
-- worker-computed column are reset here no matter what was sent.
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

-- gap #1: publish BOTH tables so the client can subscribe to the status
-- flip on `investigations` and the checklist rows on `investigation_steps`
-- (spec §7.4).
alter publication supabase_realtime add table investigations;
alter publication supabase_realtime add table investigation_steps;

-- ---------------------------------------------------------------------------
-- Webhook chain (spec §5, gap #2): AFTER INSERT fires the Edge Function
-- `emit-investigation-requested` via pg_net. The DB layer never holds an
-- Inngest endpoint or key — the Edge Function is the only place
-- INNGEST_EVENT_URL / INNGEST_EVENT_KEY live (via `supabase secrets set`).
--
-- The function endpoint and its auth token are NOT baked into this migration
-- (they are environment-specific and the token is a secret). They are read at
-- trigger time from database settings the operator sets per environment:
--   alter database postgres
--     set app.settings.emit_investigation_url   = '<functions endpoint>/emit-investigation-requested';
--   alter database postgres
--     set app.settings.emit_investigation_token = '<service_role JWT>';   -- hosted: use Vault instead
-- For the local stack these resolve to the Kong gateway alias, e.g.
--   http://kong:8000/functions/v1/emit-investigation-requested
-- See scripts/RUNBOOK.md ("Local webhook wiring").
--
-- When the URL setting is unset the trigger is a deliberate no-op: a fresh
-- `supabase db reset` (or any env that has not wired the webhook yet) still
-- inserts cleanly instead of failing the whole INSERT on a webhook error.
--
-- Prerequisite: pg_net supplies `net.http_post`. Hosted Supabase pre-installs
-- it (this is a harmless no-op there); the local CLI stack does NOT, so without
-- this line the `net` schema is absent and, once the webhook URL is wired, the
-- trigger aborts every INSERT with "schema \"net\" does not exist". The install
-- script self-creates the `net` schema, so no WITH SCHEMA is needed.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function emit_investigation_requested()
returns trigger language plpgsql as $$
declare
  emit_url text := current_setting('app.settings.emit_investigation_url', true);
  emit_token text := current_setting('app.settings.emit_investigation_token', true);
  headers jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  if emit_url is null or emit_url = '' then
    return new;  -- webhook not wired in this environment: no-op, never block the insert.
  end if;
  if emit_token is not null and emit_token <> '' then
    headers := headers || jsonb_build_object('Authorization', 'Bearer ' || emit_token);
  end if;
  -- pg_net delivers asynchronously via its background worker; the payload
  -- mirrors Supabase's Database-Webhook body so the Edge Function's
  -- WebhookPayload ({type, table, record.id}) is satisfied unchanged.
  perform net.http_post(
    url := emit_url,
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', jsonb_build_object('id', new.id)
    ),
    headers := headers
  );
  return new;
end $$;

create trigger trg_emit_requested after insert on investigations
  for each row execute function emit_investigation_requested();
