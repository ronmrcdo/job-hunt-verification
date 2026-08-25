-- H1 (security review 2026-08-26): the weekly bucket and the dedup window in
-- enforce_check_quota() both filter on `created_at`, but nothing reset it — a
-- client with the table-wide INSERT grant could POST a back-dated created_at
-- and keep weekly_used at 0 forever (unlimited free LLM runs). Force created_at
-- to now() for every metered client insert. The service/worker path (no
-- auth.uid()) returns before this line, so owner-seeded historical rows in
-- verify_rls.sql are unaffected. CREATE OR REPLACE keeps the existing
-- trg_enforce_check_quota BEFORE INSERT binding.
create or replace function enforce_check_quota()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  lim         int := coalesce(nullif(app_setting('check_quota_limit', '3'), '')::int, 3);
  win         int := coalesce(nullif(app_setting('check_quota_window_days', '7'), '')::int, 7);
  dedup_hours int := coalesce(nullif(app_setting('dedup_window_hours', '24'), '')::int, 24);
  weekly_used int;
  bal         int;
  oldest      timestamptz;
  dup_id      uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  -- H1: metered client inserts never choose their own timestamp.
  new.created_at := now();

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select id into dup_id
    from investigations
   where user_id = auth.uid()
     and submission_hash = md5(new.submission::text)
     and created_at > now() - (dedup_hours || ' hours')::interval
   order by created_at desc
   limit 1;
  if dup_id is not null then
    raise log 'submission_deduped user=% existing=%', auth.uid(), dup_id;
    raise sqlstate 'PT409'
      using message = 'duplicate_submission', hint = dup_id::text;
  end if;

  select count(*), min(created_at) into weekly_used, oldest
    from investigations
   where user_id = auth.uid()
     and quota_source = 'weekly'
     and created_at > now() - (win || ' days')::interval;

  if weekly_used < lim then
    new.quota_source := 'weekly';
    return new;
  end if;

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

  raise log 'check_quota_denied user=% weekly_used=% limit=% top_up=%',
    auth.uid(), weekly_used, lim, coalesce(bal, 0);
  raise sqlstate 'PT429'
    using message = 'check_quota_exceeded',
          hint = to_char((oldest + (win || ' days')::interval) at time zone 'utc',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"');
end $$;
