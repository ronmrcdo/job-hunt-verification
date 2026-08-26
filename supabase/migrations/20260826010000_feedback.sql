-- Component 1 (feedback→eval loop). A user's structured verdict on their OWN
-- investigation. Advisory only: a row here is a "review this" signal, never a
-- label and never a mutation of a live assessment (spec Global Constraints).
-- RLS scopes every row to its owner exactly like every other user-data table;
-- admin_ro reads across users by BYPASSRLS (20260826130000), never a policy.
-- Idempotent: guarded create + drop-then-create policies/trigger so re-running
-- `db push --include-all` is safe.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  verdict text not null check (verdict in ('agree','too_high','too_low')),
  wrong_finding_id text,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

-- One verdict per (user, investigation): a resubmission is rejected, not stacked
-- into duplicates a spammer could use to flood the triage queue.
create unique index if not exists feedback_user_investigation_uniq
  on feedback (user_id, investigation_id);

alter table feedback enable row level security;

-- Own-row insert/select only. No update/delete grant to clients at all.
drop policy if exists feedback_insert_own on feedback;
create policy feedback_insert_own on feedback
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists feedback_select_own on feedback;
create policy feedback_select_own on feedback
  for select to authenticated
  using (user_id = auth.uid());

-- created_at + user_id are server-forced (security-review H1: never trust a
-- client timestamp or identity). BEFORE INSERT stamps now() and pins user_id to
-- the caller regardless of what the client sent. Empty search_path per the
-- security-advisor migration (20260826000000).
create or replace function feedback_force_server_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  new.user_id := auth.uid();
  return new;
end $$;

drop trigger if exists feedback_force_server_fields on feedback;
create trigger feedback_force_server_fields
  before insert on feedback
  for each row execute function feedback_force_server_fields();

-- NOTE: no admin_ro grant here — that role is created in the LATER migration
-- 20260826130000_admin_ro_role.sql, whose guarded block grants SELECT on this
-- table once it exists.
