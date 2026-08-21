-- Runtime config home for the quota system (spec §4.7). Replaces the
-- app.settings.* GUCs for the quota knobs: operators tune the whole system with
-- a single UPDATE, no deploy and no `alter database`. app_setting() reads it
-- with a code-level default so an unseeded/empty table still works. Enforcement
-- runs inside Postgres (the quota trigger), which cannot read the web .env, so
-- the source of truth must be DB-readable — this table.
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
-- No client policy: the definer functions read it as owner; only service_role
-- writes it out-of-band. Clients never read settings directly.
revoke all on app_settings from anon, authenticated;

insert into app_settings (key, value) values
  ('check_quota_limit', '3'),
  ('check_quota_window_days', '7'),
  ('default_top_up_balance', '0')
on conflict (key) do nothing;

create or replace function app_setting(k text, d text)
returns text language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from app_settings where key = k), d);
$$;

revoke all on function app_setting(text, text) from public;
grant execute on function app_setting(text, text) to service_role;
