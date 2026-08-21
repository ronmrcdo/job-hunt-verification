-- Read-side of the quota (spec §4.2): the client's current window state so the
-- UI renders "N of 3 left · resets <date>" and disables submit, instead of
-- reverse-engineering it from a raw insert error. Mirrors enforce_check_quota()
-- exactly (same settings + fallbacks). security definer so the count is over
-- the caller's own rows via auth.uid().
create or replace function quota_status()
returns table(used int, "limit" int, resets_at timestamptz)
language sql security definer stable
set search_path = public
as $$
  select
    count(*)::int,
    coalesce(nullif(current_setting('app.settings.check_quota_limit', true), '')::int, 3),
    case when count(*) = 0 then null
         else min(created_at)
              + (coalesce(nullif(current_setting('app.settings.check_quota_window_days', true), '')::int, 14)
                 || ' days')::interval
    end
  from investigations
  where user_id = auth.uid()
    and created_at > now()
        - (coalesce(nullif(current_setting('app.settings.check_quota_window_days', true), '')::int, 14)
           || ' days')::interval;
$$;

revoke all on function quota_status() from public;
grant execute on function quota_status() to authenticated;
