-- Two-bucket quota (spec §4.1): charge the rolling weekly allowance first,
-- then the permanent top-up balance, else deny. Replaces the rolling-window-
-- only enforce_check_quota() from 20260821120000; the existing BEFORE INSERT
-- trigger binding is preserved by CREATE OR REPLACE. SECURITY DEFINER because
-- it now writes user_check_quota (RLS-protected against client writes); it
-- still keys everything off auth.uid() so a user only ever spends their own.
create or replace function enforce_check_quota()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  lim int := coalesce(nullif(app_setting('check_quota_limit', '3'), '')::int, 3);
  win int := coalesce(nullif(app_setting('check_quota_window_days', '7'), '')::int, 7);
  weekly_used int;
  bal int;
  oldest timestamptz;
begin
  -- Service/worker connections have no auth.uid() and never client-insert;
  -- leave them unmetered (quota_source stays NULL).
  if auth.uid() is null then
    return new;
  end if;

  -- Weekly bucket: rolling count of this user's 'weekly'-stamped rows.
  select count(*), min(created_at) into weekly_used, oldest
    from investigations
   where user_id = auth.uid()
     and quota_source = 'weekly'
     and created_at > now() - (win || ' days')::interval;

  if weekly_used < lim then
    new.quota_source := 'weekly';
    return new;
  end if;

  -- Weekly allowance spent: fall through to the permanent balance. FOR UPDATE
  -- serializes concurrent inserts from the same user so a balance of 1 cannot
  -- be double-spent. A missing row (provisioning gap) reads NULL -> treated as
  -- 0 -> denies, failing safe.
  select top_up_balance into bal
    from user_check_quota
   where user_id = auth.uid()
   for update;

  if coalesce(bal, 0) > 0 then
    update user_check_quota
       set top_up_balance = top_up_balance - 1, updated_at = now()
     where user_id = auth.uid();
    new.quota_source := 'top_up';
    return new;
  end if;

  -- Both buckets exhausted. resets_at = when the next weekly slot frees
  -- (oldest in-window 'weekly' row + window). Top-up never refreshes.
  raise log 'check_quota_denied user=% weekly_used=% limit=% top_up=%',
    auth.uid(), weekly_used, lim, coalesce(bal, 0);
  raise sqlstate 'PT429'
    using message = 'check_quota_exceeded',
          hint = to_char((oldest + (win || ' days')::interval) at time zone 'utc',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"');
end $$;
