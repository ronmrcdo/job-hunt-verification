-- Per-user rolling-window check quota (spec §4.1). Enforced in the DB because
-- the V1 web client inserts investigations rows directly via PostgREST — there
-- is no application server in the insert path. Limit/window are operator
-- settings with 3/14 fallbacks so an unset environment still works.

create index if not exists investigations_user_created_idx
  on investigations (user_id, created_at);

create or replace function enforce_check_quota()
returns trigger language plpgsql as $$
declare
  lim    int := coalesce(nullif(current_setting('app.settings.check_quota_limit', true), '')::int, 3);
  win    int := coalesce(nullif(current_setting('app.settings.check_quota_window_days', true), '')::int, 14);
  used   int;
  oldest timestamptz;
begin
  -- Service/worker connections have no auth.uid() and never client-insert
  -- investigations; leave them unmetered (future-proof, explicit).
  if auth.uid() is null then
    return new;
  end if;
  select count(*), min(created_at) into used, oldest
    from investigations
   where user_id = auth.uid()
     and created_at > now() - (win || ' days')::interval;
  if used >= lim then
    raise log 'check_quota_denied user=% used=% limit=%', auth.uid(), used, lim;
    raise sqlstate 'PT429'
      using message = 'check_quota_exceeded',
            hint = to_char((oldest + (win || ' days')::interval) at time zone 'utc',
                           'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  return new;
end $$;

create trigger trg_enforce_check_quota before insert on investigations
  for each row execute function enforce_check_quota();
