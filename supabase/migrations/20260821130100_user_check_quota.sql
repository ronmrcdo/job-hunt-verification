-- Permanent, non-refreshing top-up balance per account (spec §4.7) plus the
-- per-check bucket stamp. The balance is written only by the (definer) quota
-- trigger (decrement) and grant_top_up() (credit); clients may read their own
-- row so quota_status() and the UI can show it.
create table if not exists user_check_quota (
  user_id uuid primary key references auth.users(id) on delete cascade,
  top_up_balance int not null default 0 check (top_up_balance >= 0),
  updated_at timestamptz not null default now()
);

alter table user_check_quota enable row level security;
create policy user_check_quota_select_own on user_check_quota
  for select using (user_id = auth.uid());
revoke all on user_check_quota from anon, authenticated;
grant select on user_check_quota to authenticated;

-- Stamp the bucket each metered insert draws from. Nullable: service/worker
-- rows (auth.uid() null) stay NULL = unmetered. The weekly count filters on
-- quota_source = 'weekly'.
alter table investigations
  add column if not exists quota_source text
    check (quota_source in ('weekly', 'top_up'));

-- Provision a balance row on signup, seeded from the current default setting
-- (read at provision time, so a later default change never rewrites existing
-- balances). on conflict do nothing keeps it idempotent.
create or replace function provision_user_quota()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  insert into user_check_quota (user_id, top_up_balance)
  values (new.id, coalesce(nullif(app_setting('default_top_up_balance', '0'), '')::int, 0))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger trg_provision_user_quota after insert on auth.users
  for each row execute function provision_user_quota();

-- Backfill existing accounts with the current default.
insert into user_check_quota (user_id, top_up_balance)
select id, coalesce(nullif(app_setting('default_top_up_balance', '0'), '')::int, 0)
from auth.users
on conflict (user_id) do nothing;
