-- scripts/verify_rls.sql — operator-run only (NOT run by implementation).
-- Verifies spec §10 "Migrations/RLS" checklist against
-- docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md
-- after applying supabase/migrations/20260819073420_investigations_v1.sql
-- and supabase/migrations/20260819073430_langgraph_checkpointer.sql.
--
-- Run inside a transaction that is rolled back, e.g.:
--   supabase db execute --file scripts/verify_rls.sql
-- or, via psql against the local stack:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql
-- Each numbered block RAISEs on failure and prints an OK notice on success.
-- Case 6 (Edge Function invocation) is NOT asserted here — see the RUNBOOK
-- for how to observe it via `supabase functions logs`.
--
-- Two fake user identities, hardcoded as literals below (NOT via psql
-- `\set` + `:'var'` interpolation — psql does not substitute `:'var'`
-- inside a dollar-quoted `$$ ... $$` string, so every reference has to be
-- a plain literal or a value read back with `current_setting()`):
--   user A = 11111111-1111-1111-1111-111111111111
--   user B = 22222222-2222-2222-2222-222222222222
-- In a real Supabase local/hosted stack these would be real auth.users
-- rows (created via the Auth API); for this verification we only need the
-- JWT claims RLS reads, via `request.jwt.claims` / `auth.uid()`. If the
-- target environment requires FK-valid auth.users rows for the
-- `investigations.user_id` FK to succeed, the operator inserts matching
-- `auth.users` rows for these two UUIDs before running this script (see
-- RUNBOOK).

begin;

-- -----------------------------------------------------------------------
-- Case 1: A can insert its own row; status is forced to 'queued'
-- regardless of what the client sends.
-- -----------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_status text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  insert into investigations (user_id, submission, status)
  values (
    '11111111-1111-1111-1111-111111111111',
    '{"job_text": "a real job posting body"}'::jsonb,
    'done'  -- attempt to smuggle a terminal status; trigger must override it
  )
  returning id, status into v_id, v_status;

  if v_status is distinct from 'queued' then
    raise exception 'CASE 1 FAILED: expected status=queued, got %', v_status;
  end if;

  raise notice 'CASE 1 OK: A inserted own row, status forced to queued (id=%)', v_id;
end $$;

-- -----------------------------------------------------------------------
-- Case 2: A can select its own row; A canNOT select B's row (0 rows, not
-- an error).
-- -----------------------------------------------------------------------
do $$
declare
  v_a_id uuid;
  v_b_id uuid;
  v_count_own int;
  v_count_cross int;
begin
  -- Seed one row as B (service role bypasses RLS for setup).
  reset role;
  insert into investigations (user_id, submission)
  values ('22222222-2222-2222-2222-222222222222', '{"job_text": "b posting body"}'::jsonb)
  returning id into v_b_id;

  -- Seed a row as A too, and remember an A-owned id.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);
  insert into investigations (user_id, submission)
  values ('11111111-1111-1111-1111-111111111111', '{"job_text": "another a posting"}'::jsonb)
  returning id into v_a_id;

  select count(*) into v_count_own from investigations where id = v_a_id;
  if v_count_own <> 1 then
    raise exception 'CASE 2 FAILED: A could not select its own row (got % rows)', v_count_own;
  end if;

  select count(*) into v_count_cross from investigations where id = v_b_id;
  if v_count_cross <> 0 then
    raise exception 'CASE 2 FAILED: A could select B''s row (got % rows, expected 0)', v_count_cross;
  end if;

  raise notice 'CASE 2 OK: A sees own row, 0 rows for B''s row';
end $$;

-- -----------------------------------------------------------------------
-- Case 3: A canNOT update status or any server column (no UPDATE policy
-- => the statement affects 0 rows, or errors, but never mutates).
-- -----------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_status_before text;
  v_status_after text;
  v_rows_affected int;
begin
  reset role;
  insert into investigations (user_id, submission)
  values ('11111111-1111-1111-1111-111111111111', '{"job_text": "case 3 posting"}'::jsonb)
  returning id, status into v_id, v_status_before;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  begin
    update investigations set status = 'done' where id = v_id;
    get diagnostics v_rows_affected = row_count;
  exception when insufficient_privilege then
    v_rows_affected := 0;
  end;

  reset role;
  select status into v_status_after from investigations where id = v_id;

  if v_rows_affected <> 0 or v_status_after is distinct from v_status_before then
    raise exception 'CASE 3 FAILED: client UPDATE mutated status (before=%, after=%, rows_affected=%)',
      v_status_before, v_status_after, v_rows_affected;
  end if;

  raise notice 'CASE 3 OK: client UPDATE denied, status unchanged (%)', v_status_after;
end $$;

-- -----------------------------------------------------------------------
-- Case 4: oversize job_text (> 40000 chars) INSERT is rejected by CHECK.
-- -----------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  begin
    insert into investigations (user_id, submission)
    values (
      '11111111-1111-1111-1111-111111111111',
      jsonb_build_object('job_text', repeat('x', 40001))
    );
    raise exception 'CASE 4 FAILED: oversize job_text was accepted';
  exception when check_violation then
    raise notice 'CASE 4 OK: oversize job_text rejected by CHECK';
  end;
end $$;

-- -----------------------------------------------------------------------
-- Case 5: missing job_text ({} submission) INSERT is rejected by CHECK
-- (gap #4 — guards the NULL-CHECK trap: char_length(NULL) passes a naive
-- CHECK, so presence must be asserted explicitly).
-- -----------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  begin
    insert into investigations (user_id, submission)
    values ('11111111-1111-1111-1111-111111111111', '{}'::jsonb);
    raise exception 'CASE 5 FAILED: submission missing job_text was accepted';
  exception when check_violation then
    raise notice 'CASE 5 OK: missing job_text rejected by CHECK';
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------
-- Case 6: AFTER INSERT fires the trigger, which POSTs directly to Inngest
-- via pg_net (reading app.settings.inngest_base_url / _inngest_event_key).
-- NOT asserted by SQL here — the pg_net request is async and does not
-- reliably leave a queryable row in this local/CI context. See
-- scripts/RUNBOOK.md for how the operator confirms this case via the
-- Inngest Dev Server dashboard (or the `net._http_response` table) after
-- a real INSERT.
-- -----------------------------------------------------------------------

-- -----------------------------------------------------------------------
-- CASE 7 (sources column, gap follow-up): a client cannot seed `sources` on
-- INSERT (defaults trigger nulls it), and cannot UPDATE it (no UPDATE policy).
-- -----------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  -- INSERT attempting to set sources → trigger forces it to NULL.
  insert into investigations (user_id, submission, sources)
    values (
      '11111111-1111-1111-1111-111111111111',
      '{"job_text": "case 7 posting"}'::jsonb,
      '[{"id":"s1"}]'::jsonb
    )
    returning id into v_id;
  if (select sources from investigations where id = v_id) is not null then
    raise exception 'CASE 7 FAILED: client seeded sources on insert';
  end if;

  -- UPDATE attempting to set sources → the client cannot mutate it. Two
  -- layers enforce this and either is acceptable (same tolerance as Case 3):
  -- the missing UPDATE grant raises insufficient_privilege, and even if a
  -- grant existed the absent UPDATE policy would make it affect 0 rows.
  -- Swallow the privilege error and assert the value is still NULL.
  begin
    update investigations set sources = '[{"id":"s2"}]'::jsonb where id = v_id;
  exception when insufficient_privilege then
    null;
  end;
  if (select sources from investigations where id = v_id) is not null then
    raise exception 'CASE 7 FAILED: client updated sources';
  end if;

  raise notice 'CASE 7 OK: sources not client-writable on insert or update';
end $$;

reset role;

-- -----------------------------------------------------------------------
-- Case 8: worker-only tables are not client-readable. As `authenticated`,
-- `cache` and `checkpoints` must return 0 rows (deny-all RLS), even though
-- the worker (service_role / owner) reads them freely. Seed one row of each
-- as the bypassing role first.
-- -----------------------------------------------------------------------
do $$
declare
  v_cache int;
  v_ckpt int;
begin
  reset role;  -- service_role / owner bypasses RLS for setup
  insert into cache (key, value, expires_at)
    values ('verify-key', '{"x":1}'::jsonb, now() + interval '1 hour')
    on conflict (key) do nothing;
  insert into checkpoints (thread_id, checkpoint_id, checkpoint)
    values ('verify-thread', 'verify-ckpt', '{"x":1}'::jsonb)
    on conflict do nothing;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  select count(*) into v_cache from cache;
  select count(*) into v_ckpt from checkpoints;

  if v_cache <> 0 then
    raise exception 'CASE 8 FAILED: authenticated read % cache rows (expected 0)', v_cache;
  end if;
  if v_ckpt <> 0 then
    raise exception 'CASE 8 FAILED: authenticated read % checkpoints rows (expected 0)', v_ckpt;
  end if;

  raise notice 'CASE 8 OK: cache + checkpoints deny-all to authenticated';
end $$;

reset role;

-- -----------------------------------------------------------------------
-- Case 9: per-user rolling quota (spec §4.1). Seeds 3 rows for user A in-window,
-- asserts the 4th is rejected (PT429), user B is unaffected, and a >7-day-old
-- row does not count.
-- -----------------------------------------------------------------------
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a9';
  b uuid := '00000000-0000-0000-0000-0000000000b9';
  cc uuid := '00000000-0000-0000-0000-0000000000c9';
  denied boolean := false;
begin
  delete from investigations where user_id in (a, b, cc);
  -- seed as service role (bypasses the trigger's auth.uid() path: auth.uid() is
  -- null here, so insert directly with explicit user_id + created_at)
  insert into investigations (user_id, submission, status, created_at, quota_source) values
    (a, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (a, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (a, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (a, '{"job_text":"x"}', 'done', now() - interval '20 days', 'weekly');  -- ages out
  -- Now act as user A via JWT claim so auth.uid() = a and the trigger fires.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  set local role authenticated;
  begin
    insert into investigations (submission) values ('{"job_text":"x"}');
  exception when sqlstate 'PT429' then denied := true;
  end;
  reset role;
  if not denied then raise exception 'Case 9 FAIL: 4th in-window insert was not rejected'; end if;

  -- user B (no rows) can insert
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  set local role authenticated;
  insert into investigations (submission) values ('{"job_text":"x"}');
  reset role;

  -- Discriminator: user C has 2 in-window + 1 aged-out. If the window filter is
  -- broken (counts aged-out), C's insert would fail (used=3). Since limit=3, only
  -- excluding aged-out correctly allows it (used=2 < 3). This guards against a
  -- regression where the >now() - interval predicate becomes <= or is omitted.
  reset role;
  insert into investigations (user_id, submission, status, created_at, quota_source) values
    (cc, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (cc, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (cc, '{"job_text":"x"}', 'done', now() - interval '20 days', 'weekly');  -- ages out
  perform set_config('request.jwt.claims', json_build_object('sub', cc)::text, true);
  set local role authenticated;
  insert into investigations (submission) values ('{"job_text":"x"}');
  reset role;
  raise notice 'Case 9 (ages-out) PASS';

  raise notice 'Case 9 PASS';
  delete from investigations where user_id in (a, b, cc);
end $$;

-- -----------------------------------------------------------------------
-- Case 10: disposable-email signup block (spec §4.4). A blocked-domain insert
-- into auth.users is rejected (PT422) even under the service/owner role, because
-- a BEFORE INSERT trigger fires regardless of RLS/role.
-- -----------------------------------------------------------------------
do $$
declare blocked boolean := false;
begin
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'bot@mailinator.com');
  exception when sqlstate 'PT422' then blocked := true;
  end;
  if not blocked then raise exception 'Case 10 FAIL: blocked domain was allowed'; end if;
  raise notice 'Case 10 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 11: abuse observability views (finding C1) are not readable by
-- client roles. As `authenticated`, a SELECT on abuse_daily_spend must
-- raise insufficient_privilege (42501) — only service_role may read it.
-- -----------------------------------------------------------------------
do $$
declare denied boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  begin
    perform * from abuse_daily_spend limit 1;
    perform * from abuse_signups_hourly limit 1;
  exception when sqlstate '42501' then denied := true;
  end;

  reset role;

  if not denied then
    raise exception 'Case 11 FAIL: authenticated could select an abuse_* view';
  end if;

  raise notice 'Case 11 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 12: the intended reader (service_role) can STILL read both abuse
-- views (review Important #2). abuse_signups_hourly reads auth.users, so
-- dropping security_invoker was required for this to work under
-- service_role — this case is the regression guard for that fix.
-- -----------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform * from abuse_daily_spend limit 1;
  perform * from abuse_signups_hourly limit 1;
  perform * from abuse_snapshot();
  reset role;
  raise notice 'Case 12 PASS';
exception when others then
  reset role;
  raise exception 'Case 12 FAIL: service_role could not read abuse views/snapshot (%: %)', sqlstate, sqlerrm;
end $$;

-- -----------------------------------------------------------------------
-- Case 13: signup provisioning (spec §4.7). With default_top_up_balance set
-- to 5, a new auth.users row must get a user_check_quota row seeded to 5, and
-- an authenticated client cannot UPDATE its own balance (definer-only writes).
-- -----------------------------------------------------------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000d3';
  bal int;
  denied boolean := false;
begin
  update app_settings set value = '5' where key = 'default_top_up_balance';
  delete from auth.users where id = u;               -- cascade clears quota row
  insert into auth.users (id, email) values (u, 'newuser@example.com');
  select top_up_balance into bal from user_check_quota where user_id = u;
  if bal is distinct from 5 then
    raise exception 'Case 13 FAIL: provisioned balance % (expected 5)', bal;
  end if;

  -- client cannot write its own balance
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  set local role authenticated;
  begin
    update user_check_quota set top_up_balance = 999 where user_id = u;
    if not found then denied := true; end if;         -- RLS: 0 rows updated
  exception when sqlstate '42501' then denied := true;
  end;
  reset role;
  if not denied then raise exception 'Case 13 FAIL: client updated its own balance'; end if;

  update app_settings set value = '0' where key = 'default_top_up_balance';
  delete from auth.users where id = u;
  raise notice 'Case 13 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 14: top-up fallthrough + double-spend guard (spec §4.1/§4.7). User has
-- weekly exhausted (3 weekly rows in-window) and a top_up_balance of 2. Two
-- more inserts must succeed and stamp 'top_up', decrementing the balance to 0;
-- the next insert must raise PT429.
-- -----------------------------------------------------------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000e4';
  bal int;
  src text;
  denied boolean := false;
begin
  delete from auth.users where id = u;                -- cascade clears quota row
  insert into auth.users (id, email) values (u, 'topup@example.com');  -- provisions balance 0
  update user_check_quota set top_up_balance = 2 where user_id = u;    -- seed balance directly (owner bypasses RLS); grant_top_up() lands in Task 5
  -- weekly exhausted: three in-window weekly rows
  insert into investigations (user_id, submission, status, created_at, quota_source) values
    (u, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (u, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (u, '{"job_text":"x"}', 'done', now(), 'weekly');

  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  set local role authenticated;

  insert into investigations (submission) values ('{"job_text":"x"}')
    returning quota_source into src;
  if src is distinct from 'top_up' then reset role; raise exception 'Case 14 FAIL: 4th insert stamped % (expected top_up)', src; end if;

  insert into investigations (submission) values ('{"job_text":"x"}')
    returning quota_source into src;
  if src is distinct from 'top_up' then reset role; raise exception 'Case 14 FAIL: 5th insert stamped % (expected top_up)', src; end if;

  begin
    insert into investigations (submission) values ('{"job_text":"x"}');
  exception when sqlstate 'PT429' then denied := true;
  end;
  reset role;
  if not denied then raise exception 'Case 14 FAIL: 6th insert (both buckets empty) was not rejected'; end if;

  select top_up_balance into bal from user_check_quota where user_id = u;
  if bal is distinct from 0 then raise exception 'Case 14 FAIL: balance % (expected 0)', bal; end if;

  delete from investigations where user_id = u;  -- no ON DELETE CASCADE on investigations_user_id_fkey
  delete from auth.users where id = u;
  raise notice 'Case 14 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 15: quota_status() reports both buckets (spec §4.2). User has 2 weekly
-- rows in-window and a top_up_balance of 4; quota_status() must return
-- weekly_used=2, weekly_limit=3, top_up_balance=4, resets_at not null.
-- -----------------------------------------------------------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000f5';
  r record;
begin
  delete from auth.users where id = u;
  insert into auth.users (id, email) values (u, 'status@example.com');  -- provisions balance 0
  update user_check_quota set top_up_balance = 4 where user_id = u;     -- seed balance directly; grant_top_up() lands in Task 5
  insert into investigations (user_id, submission, status, created_at, quota_source) values
    (u, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (u, '{"job_text":"x"}', 'done', now(), 'weekly');

  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  set local role authenticated;
  select * into r from quota_status();
  reset role;

  if r.weekly_used <> 2 or r.weekly_limit <> 3 or r.top_up_balance <> 4 or r.resets_at is null then
    raise exception 'Case 15 FAIL: got weekly_used=% weekly_limit=% top_up=% resets_at=%',
      r.weekly_used, r.weekly_limit, r.top_up_balance, r.resets_at;
  end if;

  delete from investigations where user_id = u;   -- investigations FK has no ON DELETE CASCADE; clear before the user delete
  delete from auth.users where id = u;
  raise notice 'Case 15 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 16: grant_top_up() adds to the balance; a claw-back below zero raises
-- (the >= 0 check on the column); authenticated cannot execute it (spec §4.7).
-- -----------------------------------------------------------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000a16';
  bal int;
  raised boolean := false;
  denied boolean := false;
begin
  delete from auth.users where id = u;
  insert into auth.users (id, email) values (u, 'grant@example.com');   -- provisions balance 0

  bal := grant_top_up(u, 10);
  if bal <> 10 then raise exception 'Case 16 FAIL: grant returned % (expected 10)', bal; end if;
  bal := grant_top_up(u, -3);
  if bal <> 7 then raise exception 'Case 16 FAIL: after claw-back balance % (expected 7)', bal; end if;

  begin
    perform grant_top_up(u, -100);                    -- would go negative
  exception when check_violation then raised := true;
  end;
  if not raised then raise exception 'Case 16 FAIL: below-zero claw-back did not raise'; end if;

  -- authenticated cannot execute grant_top_up
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  set local role authenticated;
  begin
    perform grant_top_up(u, 1);
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  if not denied then raise exception 'Case 16 FAIL: authenticated executed grant_top_up'; end if;

  delete from auth.users where id = u;
  raise notice 'Case 16 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 17: public_stats() — the landing rail's three all-time numbers.
-- Asserts the terminal-status trigger stamps finished_at exactly once, that
-- the aggregate counts only 'done' rows, and that anon (an unauthenticated
-- landing-page visitor) may execute it while still being unable to select
-- the underlying rows.
--
-- The function aggregates the WHOLE table, so the exact-value assertions
-- only run when the table was empty to begin with (a fresh local stack);
-- on a database with pre-existing rows the case degrades to delta and
-- not-null assertions rather than reporting a false failure.
-- -----------------------------------------------------------------------
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000a17';
  inv1 uuid;
  inv2 uuid;
  base int;
  n int;
  pct int;
  med int;
  stamp1 timestamptz;
  stamp2 timestamptz;
  denied boolean := false;
begin
  delete from investigations where user_id = u;   -- FK has no cascade: rows first
  delete from auth.users where id = u;
  insert into auth.users (id, email) values (u, 'stats@example.com');

  select postings_checked into base from public_stats();

  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into investigations (user_id, submission)
    values (u, '{"job_text":"stats case one"}'::jsonb) returning id into inv1;
  insert into investigations (user_id, submission)
    values (u, '{"job_text":"stats case two"}'::jsonb) returning id into inv2;

  -- Backdate the first submission so the median measures a known ~100s.
  -- This UPDATE must NOT stamp finished_at: the row is still 'queued'.
  update investigations set created_at = now() - interval '100 seconds' where id = inv1;
  select finished_at into stamp1 from investigations where id = inv1;
  if stamp1 is not null then
    raise exception 'Case 17 FAIL: non-terminal update stamped finished_at';
  end if;

  -- 4 findings, 3 of them carrying source ids => 75%.
  update investigations set status = 'done', findings = '[
      {"id":"f1","source_ids":["s1"]},
      {"id":"f2","source_ids":["s1","s2"]},
      {"id":"f3","source_ids":["s3"]},
      {"id":"f4","source_ids":[]}
    ]'::jsonb where id = inv1;
  update investigations set status = 'failed' where id = inv2;

  select finished_at into stamp1 from investigations where id = inv1;
  select finished_at into stamp2 from investigations where id = inv2;
  if stamp1 is null then raise exception 'Case 17 FAIL: done row was not stamped'; end if;
  if stamp2 is null then raise exception 'Case 17 FAIL: failed row was not stamped'; end if;

  -- Write-once: a replayed terminal write must not move the stamp.
  update investigations set status = 'done', check_count = 1 where id = inv1;
  if (select finished_at from investigations where id = inv1) is distinct from stamp1 then
    raise exception 'Case 17 FAIL: replayed terminal write moved finished_at';
  end if;

  select postings_checked, findings_with_sources_pct, median_seconds
    into n, pct, med from public_stats();
  if n <> base + 1 then
    raise exception 'Case 17 FAIL: postings_checked % (expected %; the failed row must not count)', n, base + 1;
  end if;
  if pct is null or med is null then
    raise exception 'Case 17 FAIL: pct=% median=% (expected both non-null)', pct, med;
  end if;
  if base = 0 then
    if pct <> 75 then raise exception 'Case 17 FAIL: findings pct % (expected 75)', pct; end if;
    if med not between 95 and 105 then
      raise exception 'Case 17 FAIL: median_seconds % (expected ~100)', med;
    end if;
  else
    raise notice 'Case 17: % pre-existing rows — exact pct/median assertions skipped', base;
  end if;

  -- anon may execute the aggregate but still cannot read the rows behind it.
  set local role anon;
  perform public_stats();
  begin
    perform 1 from investigations where id = inv1;
    if found then reset role; raise exception 'Case 17 FAIL: anon selected an investigation row'; end if;
  exception when insufficient_privilege then denied := true;
  end;
  reset role;

  delete from investigations where user_id = u;
  delete from auth.users where id = u;
  raise notice 'Case 17 PASS';
end $$;

-- -----------------------------------------------------------------------
-- Case 18: blocked_email_domains is not client-readable (20260826000000).
-- The table backs the disposable-email signup gate; reject_disposable_email()
-- reads it as owner (SECURITY DEFINER, bypassing RLS), so deny-all RLS here is
-- invisible to signups (Case 10 still passes). As `authenticated`, a SELECT
-- must return 0 rows even though the table is non-empty for the owner. Seed a
-- row as the bypassing role first to prove it's suppression, not emptiness.
-- -----------------------------------------------------------------------
do $$
declare
  v_owner int;
  v_client int;
begin
  reset role;  -- owner bypasses RLS
  select count(*) into v_owner from blocked_email_domains;
  if v_owner = 0 then
    raise exception 'Case 18 FAILED: blocked_email_domains empty for owner (seed list missing?)';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
    true);

  select count(*) into v_client from blocked_email_domains;
  reset role;

  if v_client <> 0 then
    raise exception 'Case 18 FAILED: authenticated read % blocked_email_domains rows (expected 0)', v_client;
  end if;

  raise notice 'Case 18 OK: blocked_email_domains deny-all to authenticated (% rows for owner)', v_owner;
end $$;

-- -----------------------------------------------------------------------
-- Case 19 (H1, 20260826120000): a client cannot back-date created_at to
-- escape the weekly window. Insert as an authenticated user with an ancient
-- created_at and assert the stored value was forced to ~now() by
-- enforce_check_quota().
-- -----------------------------------------------------------------------
do $$
declare
  uid uuid := gen_random_uuid();
  got timestamptz;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  set local role authenticated;
  insert into investigations (user_id, submission, created_at)
    values (uid, '{"job_text":"x"}'::jsonb, timestamptz '2000-01-01T00:00:00Z')
    returning created_at into got;
  reset role;
  if got < now() - interval '1 minute' then
    raise exception 'Case 19 FAIL: created_at was not pinned (got %)', got;
  end if;
  raise notice 'Case 19 PASS: created_at pinned to now() on client insert';
end $$;

-- -----------------------------------------------------------------------
-- Case 20 (M2, 20260826121000): an oversized submission field is rejected
-- by the DB, not just by the client. A 10k-char company_name must violate
-- the size constraint.
-- -----------------------------------------------------------------------
do $$
declare
  uid uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  set local role authenticated;
  begin
    insert into investigations (user_id, submission)
      values (uid, jsonb_build_object('job_text', 'x',
              'company_name', repeat('a', 10000)));
    reset role;
    raise exception 'Case 20 FAIL: oversized company_name was accepted';
  exception when check_violation then
    reset role;
    raise notice 'Case 20 PASS: oversized submission field rejected';
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------
-- Case 21 (feedback→eval loop, 20260826010000): a user cannot read another
-- user's feedback. Insert a row as user A, then attempt to SELECT it as user B
-- under the authenticated role; RLS must return zero rows.
-- -----------------------------------------------------------------------
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  inv uuid;
  visible int;
begin
  -- seed an investigation + feedback owned by A (definer context, RLS bypassed)
  insert into investigations (user_id, submission)
    values (a, jsonb_build_object('job_text', 'x')) returning id into inv;
  insert into feedback (investigation_id, user_id, verdict) values (inv, a, 'too_high');

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  set local role authenticated;
  select count(*) into visible from feedback where user_id = a;
  reset role;
  if visible <> 0 then
    raise exception 'Case 21 FAIL: user B saw % of user A''s feedback rows', visible;
  end if;
  raise notice 'Case 21 PASS: feedback is owner-isolated under RLS';
end $$;

-- -----------------------------------------------------------------------
-- Case 22 (feedback→eval loop, 20260826010100): eval_candidate is an internal
-- table — the authenticated role must see zero rows and be denied insert.
-- -----------------------------------------------------------------------
do $$
declare
  uid uuid := gen_random_uuid();
  inv uuid;
  visible int;
begin
  insert into investigations (user_id, submission)
    values (uid, jsonb_build_object('job_text', 'x')) returning id into inv;
  insert into eval_candidate (investigation_id, submission_snapshot, expected_max_band, promoted_by)
    values (inv, jsonb_build_object('job_text', 'x'), 'LOW', 'seed@example.com');

  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  set local role authenticated;
  select count(*) into visible from eval_candidate;
  if visible <> 0 then
    reset role;
    raise exception 'Case 22 FAIL: authenticated saw % eval_candidate rows', visible;
  end if;
  begin
    insert into eval_candidate (investigation_id, submission_snapshot, expected_max_band, promoted_by)
      values (inv, jsonb_build_object('job_text', 'y'), 'LOW', 'attacker@example.com');
    reset role;
    raise exception 'Case 22 FAIL: authenticated was allowed to insert eval_candidate';
  exception when insufficient_privilege then
    reset role;
    raise notice 'Case 22 PASS: eval_candidate is deny-all to authenticated';
  end;
end $$;

rollback;
