-- Read side of the two-bucket quota (spec §4.2). Returns both buckets so the
-- UI shows "N of 3 weekly left · resets <date>" plus "+M bonus checks" and
-- disables submit only when both are empty. Mirrors enforce_check_quota()
-- exactly (same 'weekly' filter + settings). security definer so the count is
-- over the caller's own rows via auth.uid(); balance via left join (0 if none).
-- Return shape changed (3 cols -> 4), so drop the prior signature first —
-- `create or replace` cannot alter the OUT parameter row type.
drop function if exists quota_status();

create or replace function quota_status()
returns table(weekly_used int, weekly_limit int, resets_at timestamptz, top_up_balance int)
language sql security definer stable
set search_path = public
as $$
  select
    coalesce(w.used, 0),
    coalesce(nullif(app_setting('check_quota_limit', '3'), '')::int, 3),
    w.resets_at,
    coalesce(q.top_up_balance, 0)
  from (
    select
      count(*)::int as used,
      case when count(*) = 0 then null
           else min(created_at)
                + (coalesce(nullif(app_setting('check_quota_window_days', '7'), '')::int, 7)
                   || ' days')::interval
      end as resets_at
    from investigations
    where user_id = auth.uid()
      and quota_source = 'weekly'
      and created_at > now()
          - (coalesce(nullif(app_setting('check_quota_window_days', '7'), '')::int, 7)
             || ' days')::interval
  ) w
  left join user_check_quota q on q.user_id = auth.uid();
$$;

revoke all on function quota_status() from public;
grant execute on function quota_status() to authenticated;
