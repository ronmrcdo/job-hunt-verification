-- Operator-facing abuse observability (spec §4.5). No new service: two views +
-- a snapshot function. Quota denials are observable via the RAISE LOG line in
-- enforce_check_quota() (Postgres logs).
create or replace view abuse_daily_spend
  with (security_invoker = true) as
  select date_trunc('day', created_at) as day,
         count(*) as investigation_count,
         coalesce(sum((cost->>'total_usd')::numeric), 0) as total_usd
  from investigations
  group by 1
  order by 1 desc;

create or replace view abuse_signups_hourly
  with (security_invoker = true) as
  select date_trunc('hour', created_at) as hour, count(*) as signups
  from auth.users
  group by 1
  order by 1 desc;

create or replace function abuse_snapshot()
returns table(today_usd numeric, signups_24h bigint)
language sql security definer stable
set search_path = public
as $$
  select
    (select coalesce(sum((cost->>'total_usd')::numeric), 0)
       from investigations
      where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')),
    (select count(*) from auth.users where created_at > now() - interval '24 hours');
$$;

-- Operator/monitoring reads only; never the anon or authenticated client roles.
grant select on abuse_daily_spend, abuse_signups_hourly to service_role;
revoke all on abuse_daily_spend, abuse_signups_hourly from anon, authenticated;
revoke all on function abuse_snapshot() from public;
grant execute on function abuse_snapshot() to service_role;
