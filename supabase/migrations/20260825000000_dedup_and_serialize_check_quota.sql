-- Harden investigation submission against click/parallel abuse (two fixes):
--
--   1. Per-user serialization. The weekly bucket in enforce_check_quota() is a
--      read-then-insert: `count(*) ... where quota_source='weekly'` then
--      `if weekly_used < lim`. Under READ COMMITTED two concurrent inserts from
--      the same user each see the same count, both pass, both commit — blowing
--      past the limit. A transaction-scoped advisory lock keyed on the user
--      serializes their inserts so the count is always accurate. (The top-up
--      bucket was already safe via SELECT ... FOR UPDATE.)
--
--   2. Idempotent dedup. gen_random_uuid() ids + no dedup key means N submits =
--      N investigations (N Inngest runs, N LLM bills). If a user re-submits an
--      identical job within a window (dedup_window_hours, default 24), reuse the
--      existing investigation instead of starting a new one: signal PT409 with
--      the existing id in the hint; the web client redirects there (see
--      apps/web/lib/investigations.ts). No new row, no quota spent.
--
-- CREATE OR REPLACE keeps the existing BEFORE INSERT trigger binding
-- (trg_enforce_check_quota from 20260821120000 / 130200).

-- Content key for dedup. jsonb::text is normalized (sorted keys, canonical
-- formatting) so md5 is stable regardless of client key order. `submission` is
-- NOT NULL, so the hash is never null. STORED + indexed for cheap lookups.
alter table investigations
  add column if not exists submission_hash text
  generated always as (md5(submission::text)) stored;

create index if not exists investigations_user_hash_created_idx
  on investigations (user_id, submission_hash, created_at desc);

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
  -- Service/worker connections have no auth.uid() and never client-insert;
  -- leave them unmetered (quota_source stays NULL) and un-deduped.
  if auth.uid() is null then
    return new;
  end if;

  -- (1) Serialize this user's concurrent inserts for the rest of the txn, so
  -- the weekly count below cannot be double-spent by parallel submits. Per-user
  -- key -> no cross-user contention; auto-released at commit/rollback, and these
  -- are single-statement PostgREST inserts so it is held only microseconds.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  -- (2) Idempotent dedup: an identical submission from this user inside the
  -- window means "take them to the one they already have" rather than spend a
  -- fresh run. Raise BEFORE any quota work so a duplicate costs nothing.
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

  -- Weekly allowance spent: fall through to the permanent balance. The advisory
  -- lock above already serializes this user, so FOR UPDATE is now belt-and-
  -- suspenders (kept so the row lock survives if the lock is ever removed).
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

  -- Both buckets exhausted. resets_at = when the next weekly slot frees.
  raise log 'check_quota_denied user=% weekly_used=% limit=% top_up=%',
    auth.uid(), weekly_used, lim, coalesce(bal, 0);
  raise sqlstate 'PT429'
    using message = 'check_quota_exceeded',
          hint = to_char((oldest + (win || ' days')::interval) at time zone 'utc',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"');
end $$;
