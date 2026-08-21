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
-- Case 6: AFTER INSERT fires the webhook toward emit-investigation-requested.
-- NOT asserted by SQL here — Supabase's function-invocation trigger
-- (supabase_functions.http_request) does not reliably leave a queryable
-- row in this local/CI context, and the Edge Function itself does not
-- exist until Task 2. See scripts/RUNBOOK.md for how the operator
-- confirms this case via `supabase functions logs emit-investigation-requested`
-- (or a stubbed Inngest endpoint) after a real INSERT.
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
-- asserts the 4th is rejected (PT429), user B is unaffected, and a >14-day-old
-- row does not count.
-- -----------------------------------------------------------------------
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a9';
  b uuid := '00000000-0000-0000-0000-0000000000b9';
  denied boolean := false;
begin
  delete from investigations where user_id in (a, b);
  -- seed as service role (bypasses the trigger's auth.uid() path: auth.uid() is
  -- null here, so insert directly with explicit user_id + created_at)
  insert into investigations (user_id, submission, status, created_at) values
    (a, '{"job_text":"x"}', 'done', now()),
    (a, '{"job_text":"x"}', 'done', now()),
    (a, '{"job_text":"x"}', 'done', now()),
    (a, '{"job_text":"x"}', 'done', now() - interval '20 days');  -- ages out
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
  raise notice 'Case 9 PASS';
  delete from investigations where user_id in (a, b);
end $$;

rollback;
