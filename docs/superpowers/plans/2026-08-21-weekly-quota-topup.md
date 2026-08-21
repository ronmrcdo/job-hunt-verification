# Weekly Quota + Non-Refreshing Top-Up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the per-account check quota to a rolling 7-day weekly allowance of 3, add a non-refreshing per-account top-up balance charged after the weekly allowance, and move the quota knobs into a runtime `app_settings` table.

**Architecture:** Enforcement stays in the database (the web client inserts `investigations` directly via PostgREST — no app server in the insert path). A `BEFORE INSERT` trigger charges the weekly bucket first (rolling 7-day count of rows stamped `quota_source='weekly'`), falls through to a permanent `top_up_balance` (row-locked decrement), else raises `PT429`. A `quota_status()` RPC reports both buckets to the `/verify` UI. Config lives in an `app_settings` key/value table read via an `app_setting(key, default)` helper.

**Tech Stack:** Supabase/Postgres (plpgsql triggers + SQL functions, RLS), Next.js/TypeScript web client (`@supabase/supabase-js`), pytest (migration text-assertions), `scripts/verify_rls.sql` (behavioral DB checks run against a live local stack), vitest (web).

**Spec:** `docs/superpowers/specs/2026-08-21-check-quota-anti-abuse-design.md` (see §4.1, §4.2, §4.7, §5, §7–§10; this plan implements amendment phases §9a A–E).

## Global Constraints

- **Migrations are append-only.** The shipped quota migrations `20260821120000`–`20260821123000` are immutable. All changes land as NEW migration files; functions change via `CREATE OR REPLACE`, tables/columns via additive `ALTER`/`CREATE`.
- **Config home is the `app_settings` table**, not `.env` and not `app.settings.*` GUCs (the DB trigger cannot read the web `.env`). Keys: `check_quota_limit` (default `3`), `check_quota_window_days` (default `7`), `default_top_up_balance` (default `0`). Every read uses `app_setting(key, default)` with a code-level default so an unseeded table still works.
- **Charge order is fixed: weekly first, then top-up.** The weekly allowance is use-it-or-lose-it (rolling 7-day window); the top-up never refreshes.
- **Every metered insert is stamped** `quota_source ∈ {'weekly','top_up'}`. Service/worker inserts (`auth.uid()` null) stay unmetered (`quota_source` NULL).
- **`default_top_up_balance` seeds new accounts only** (read at provision time); it never retroactively rewrites existing balances.
- **Balance-mutating functions are `SECURITY DEFINER` with `set search_path = public`.** `grant_top_up()` is executable by `service_role` only; `quota_status()` by `authenticated` only.
- **Do not add a Claude co-author trailer to commits** (user global rule). Commit messages may end with the `Claude-Session:` line only.
- **New migration filenames** (timestamped after the shipped set):
  - `20260821130000_app_settings.sql`
  - `20260821130100_user_check_quota.sql`
  - `20260821130200_enforce_check_quota_weekly_topup.sql`
  - `20260821130300_quota_status_weekly_topup.sql`
  - `20260821130400_grant_top_up.sql`
- **New pytest file:** `apps/api/tests/migrations/test_weekly_quota_topup.py` (keeps the shipped `test_check_quota_anti_abuse.py` stable). `_sql()` lowercases file contents, so all text-assertions below are lowercase and match the migration text **verbatim** (mind exact spacing — the SQL in this plan is written to match the assertions).
- **Commands:**
  - Migration text-assertions (no DB needed): `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
  - Apply migrations to local stack: `supabase db reset`
  - Behavioral DB checks: `psql "$(supabase status -o json | jq -r '.DB_URL')" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql`
  - Web tests: `cd apps/web && pnpm test`

---

## File Structure

- `supabase/migrations/20260821130000_app_settings.sql` — `app_settings` table + seed + `app_setting()` helper (config home).
- `supabase/migrations/20260821130100_user_check_quota.sql` — `user_check_quota` table + RLS, `investigations.quota_source` column, `provision_user_quota()` trigger on `auth.users` + backfill.
- `supabase/migrations/20260821130200_enforce_check_quota_weekly_topup.sql` — `CREATE OR REPLACE enforce_check_quota()` (two-bucket, definer).
- `supabase/migrations/20260821130300_quota_status_weekly_topup.sql` — `CREATE OR REPLACE quota_status()` (4-column shape).
- `supabase/migrations/20260821130400_grant_top_up.sql` — `grant_top_up()` admin RPC.
- `apps/api/tests/migrations/test_weekly_quota_topup.py` — migration text-assertions (all five migrations).
- `scripts/verify_rls.sql` — new behavioral cases 13–16; **update existing Case 9** to stamp `quota_source='weekly'` on its seed rows.
- `apps/web/lib/investigations.ts` — `QuotaStatus` type + `quotaStatus()` mapping (4 new columns).
- `apps/web/lib/__tests__/investigations.test.ts` — `quotaStatus()` mapping test.
- `apps/web/components/verify/NewCheckForm.tsx` — render weekly + bonus, disable only when both empty.
- `apps/web/components/verify/__tests__/NewCheckForm.test.tsx` — component states (create if absent).
- `scripts/RUNBOOK.md` — operator docs for `app_settings`, `grant_top_up()`, `default_top_up_balance`.

---

## Task A: Settings table (`app_settings` + `app_setting()`)

**Files:**
- Create: `supabase/migrations/20260821130000_app_settings.sql`
- Test: `apps/api/tests/migrations/test_weekly_quota_topup.py`

**Interfaces:**
- Produces: table `app_settings(key text pk, value text not null, updated_at timestamptz)`; function `app_setting(k text, d text) returns text` (SECURITY DEFINER, STABLE) — used by every later task. Seeded keys: `check_quota_limit=3`, `check_quota_window_days=7`, `default_top_up_balance=0`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/migrations/test_weekly_quota_topup.py`:

```python
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def _sql(name: str) -> str:
    p = MIGRATIONS / name
    return p.read_text().lower() if p.exists() else ""


APP = _sql("20260821130000_app_settings.sql")


def test_app_settings_table_created():
    assert "create table if not exists app_settings" in APP
    assert "key text primary key" in APP
    assert "value text not null" in APP


def test_app_settings_seed_rows():
    assert "'check_quota_limit', '3'" in APP
    assert "'check_quota_window_days', '7'" in APP
    assert "'default_top_up_balance', '0'" in APP
    assert "on conflict (key) do nothing" in APP


def test_app_setting_helper_is_security_definer_with_default():
    assert "create or replace function app_setting(k text, d text)" in APP
    assert "security definer" in APP
    assert "set search_path = public" in APP
    assert "coalesce((select value from app_settings where key = k), d)" in APP


def test_app_settings_not_client_writable():
    assert "alter table app_settings enable row level security" in APP
    assert "revoke all on app_settings from anon, authenticated" in APP
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: FAIL — `APP` is `""` (migration file does not exist), so every `in APP` assertion fails.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821130000_app_settings.sql`:

```sql
-- Runtime config home for the quota system (spec §4.7). Replaces the
-- app.settings.* GUCs for the quota knobs: operators tune the whole system with
-- a single UPDATE, no deploy and no `alter database`. app_setting() reads it
-- with a code-level default so an unseeded/empty table still works. Enforcement
-- runs inside Postgres (the quota trigger), which cannot read the web .env, so
-- the source of truth must be DB-readable — this table.
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
-- No client policy: the definer functions read it as owner; only service_role
-- writes it out-of-band. Clients never read settings directly.
revoke all on app_settings from anon, authenticated;

insert into app_settings (key, value) values
  ('check_quota_limit', '3'),
  ('check_quota_window_days', '7'),
  ('default_top_up_balance', '0')
on conflict (key) do nothing;

create or replace function app_setting(k text, d text)
returns text language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from app_settings where key = k), d);
$$;

revoke all on function app_setting(text, text) from public;
grant execute on function app_setting(text, text) to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: PASS (the four Task A tests; later-task tests are not yet written).

- [ ] **Step 5: Apply to the local stack and sanity-check**

Run: `supabase db reset`
Then: `psql "$(supabase status -o json | jq -r '.DB_URL')" -c "select app_setting('check_quota_limit','x'), app_setting('nope','fallback');"`
Expected: returns `3 | fallback`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/tests/migrations/test_weekly_quota_topup.py supabase/migrations/20260821130000_app_settings.sql
git commit -m "feat(db): add app_settings config table for quota knobs

Claude-Session: https://claude.ai/code/session_01S59Fmci1gdtQJM7hQo6S12"
```

---

## Task B: Top-up state, `quota_source` column, provisioning + backfill

**Files:**
- Create: `supabase/migrations/20260821130100_user_check_quota.sql`
- Modify: `apps/api/tests/migrations/test_weekly_quota_topup.py`
- Modify: `scripts/verify_rls.sql` (new Case 13)

**Interfaces:**
- Consumes: `app_setting()` from Task A.
- Produces: table `user_check_quota(user_id uuid pk → auth.users on delete cascade, top_up_balance int not null default 0 check (top_up_balance >= 0), updated_at timestamptz)`; column `investigations.quota_source text check (quota_source in ('weekly','top_up'))`; trigger `trg_provision_user_quota after insert on auth.users`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/migrations/test_weekly_quota_topup.py`:

```python
STATE = _sql("20260821130100_user_check_quota.sql")


def test_user_check_quota_table():
    assert "create table if not exists user_check_quota" in STATE
    assert "user_id uuid primary key references auth.users(id) on delete cascade" in STATE
    assert "top_up_balance int not null default 0 check (top_up_balance >= 0)" in STATE


def test_user_check_quota_rls_select_own_no_client_write():
    assert "alter table user_check_quota enable row level security" in STATE
    assert "for select using (user_id = auth.uid())" in STATE
    assert "revoke all on user_check_quota from anon, authenticated" in STATE
    assert "grant select on user_check_quota to authenticated" in STATE


def test_quota_source_column_added():
    assert "add column if not exists quota_source text" in STATE
    assert "check (quota_source in ('weekly', 'top_up'))" in STATE


def test_provision_trigger_seeds_default_balance():
    assert "create or replace function provision_user_quota()" in STATE
    assert "security definer" in STATE
    assert "app_setting('default_top_up_balance', '0')" in STATE
    assert "trigger trg_provision_user_quota after insert on auth.users" in STATE


def test_existing_users_backfilled():
    assert "insert into user_check_quota (user_id, top_up_balance)" in STATE
    assert "from auth.users" in STATE


def test_verify_rls_has_provisioning_case():
    assert "case 13" in VERIFY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: FAIL — the six new tests fail (`STATE` is `""`; `case 13` not in `VERIFY`). Task A tests still PASS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821130100_user_check_quota.sql`:

```sql
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: all migration-text tests PASS **except** `test_verify_rls_has_provisioning_case` (Case 13 not written yet — that's next).

- [ ] **Step 5: Add behavioral Case 13 to `verify_rls.sql`**

Insert **before the final `rollback;`** in `scripts/verify_rls.sql`:

```sql
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
```

- [ ] **Step 6: Run migrations + behavioral check**

Run: `supabase db reset`
Then: `psql "$(supabase status -o json | jq -r '.DB_URL')" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql`
Expected: output includes `Case 13 PASS` and no failures.
Then re-run the pytest command; `test_verify_rls_has_provisioning_case` now PASSES.

- [ ] **Step 7: Commit**

```bash
git add apps/api/tests/migrations/test_weekly_quota_topup.py supabase/migrations/20260821130100_user_check_quota.sql scripts/verify_rls.sql
git commit -m "feat(db): add top-up balance, quota_source stamp, signup provisioning

Claude-Session: https://claude.ai/code/session_01S59Fmci1gdtQJM7hQo6S12"
```

---

## Task C: Two-bucket enforcement (`enforce_check_quota()` rewrite)

**Files:**
- Create: `supabase/migrations/20260821130200_enforce_check_quota_weekly_topup.sql`
- Modify: `apps/api/tests/migrations/test_weekly_quota_topup.py`
- Modify: `scripts/verify_rls.sql` — **update Case 9** (seed rows must stamp `quota_source='weekly'`) and add Case 14 (top-up fallthrough + double-spend).

**Interfaces:**
- Consumes: `app_setting()` (Task A); `user_check_quota`, `investigations.quota_source` (Task B).
- Produces: `enforce_check_quota()` (CREATE OR REPLACE) — weekly-first → top-up (row-locked decrement) → `PT429`, stamps `NEW.quota_source`, `SECURITY DEFINER`. The existing `trg_enforce_check_quota before insert on investigations` binding is reused (replacing the function keeps the trigger).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/migrations/test_weekly_quota_topup.py`:

```python
ENFORCE = _sql("20260821130200_enforce_check_quota_weekly_topup.sql")


def test_enforce_is_security_definer():
    assert "create or replace function enforce_check_quota()" in ENFORCE
    assert "security definer" in ENFORCE
    assert "set search_path = public" in ENFORCE


def test_enforce_reads_settings_from_table():
    assert "app_setting('check_quota_limit', '3')" in ENFORCE
    assert "app_setting('check_quota_window_days', '7')" in ENFORCE


def test_enforce_counts_only_weekly_source_in_window():
    assert "quota_source = 'weekly'" in ENFORCE
    assert "created_at > now() - (win || ' days')::interval" in ENFORCE


def test_enforce_charges_weekly_then_topup_with_row_lock():
    assert "new.quota_source := 'weekly'" in ENFORCE
    assert "from user_check_quota" in ENFORCE
    assert "for update" in ENFORCE
    assert "top_up_balance = top_up_balance - 1" in ENFORCE
    assert "new.quota_source := 'top_up'" in ENFORCE


def test_enforce_denies_with_pt429_and_hint_and_logs():
    assert "auth.uid() is null" in ENFORCE
    assert "raise log" in ENFORCE
    assert "pt429" in ENFORCE
    assert "check_quota_exceeded" in ENFORCE
    assert "hint" in ENFORCE


def test_verify_rls_has_topup_case():
    assert "case 14" in VERIFY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: FAIL — the six new tests fail (`ENFORCE` is `""`; `case 14` absent). Earlier tests still PASS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821130200_enforce_check_quota_weekly_topup.sql`:

```sql
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: migration-text tests PASS except `test_verify_rls_has_topup_case` (Case 14 next).

- [ ] **Step 5: Update Case 9 in `verify_rls.sql`**

The new weekly count tallies only `quota_source='weekly'` rows, so Case 9's service-role seed rows (which insert NULL `quota_source`) would no longer count and the 4th insert would wrongly succeed. Add `quota_source` to the three seed `insert ... values` blocks in Case 9 so the seeded rows count as weekly. In `scripts/verify_rls.sql`, Case 9:

Change the user-A seed:
```sql
  insert into investigations (user_id, submission, status, created_at) values
    (a, '{"job_text":"x"}', 'done', now()),
    (a, '{"job_text":"x"}', 'done', now()),
    (a, '{"job_text":"x"}', 'done', now()),
    (a, '{"job_text":"x"}', 'done', now() - interval '20 days');  -- ages out
```
to:
```sql
  insert into investigations (user_id, submission, status, created_at, quota_source) values
    (a, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (a, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (a, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (a, '{"job_text":"x"}', 'done', now() - interval '20 days', 'weekly');  -- ages out
```
And change the user-C seed:
```sql
  insert into investigations (user_id, submission, status, created_at) values
    (cc, '{"job_text":"x"}', 'done', now()),
    (cc, '{"job_text":"x"}', 'done', now()),
    (cc, '{"job_text":"x"}', 'done', now() - interval '20 days');  -- ages out
```
to:
```sql
  insert into investigations (user_id, submission, status, created_at, quota_source) values
    (cc, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (cc, '{"job_text":"x"}', 'done', now(), 'weekly'),
    (cc, '{"job_text":"x"}', 'done', now() - interval '20 days', 'weekly');  -- ages out
```
Also update the Case 9 window comment `>14-day-old` → `>7-day-old` (the aged-out seed at `-20 days` still ages out under a 7-day window, so the assertion holds unchanged).

- [ ] **Step 6: Add behavioral Case 14 to `verify_rls.sql`**

Insert before the final `rollback;`:

```sql
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
  insert into auth.users (id, email) values (u, 'topup@example.com');
  perform grant_top_up(u, 2);
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

  delete from auth.users where id = u;
  raise notice 'Case 14 PASS';
end $$;
```

- [ ] **Step 7: Run migrations + behavioral checks**

Run: `supabase db reset`
Then: `psql "$(supabase status -o json | jq -r '.DB_URL')" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql`
Expected: `Case 9 PASS`, `Case 9 (ages-out) PASS`, `Case 13 PASS`, `Case 14 PASS`, no failures.
Then re-run pytest; `test_verify_rls_has_topup_case` PASSES.

- [ ] **Step 8: Commit**

```bash
git add apps/api/tests/migrations/test_weekly_quota_topup.py supabase/migrations/20260821130200_enforce_check_quota_weekly_topup.sql scripts/verify_rls.sql
git commit -m "feat(db): two-bucket quota enforcement (weekly then top-up)

Claude-Session: https://claude.ai/code/session_01S59Fmci1gdtQJM7hQo6S12"
```

---

## Task D: `quota_status()` new shape + web UX

**Files:**
- Create: `supabase/migrations/20260821130300_quota_status_weekly_topup.sql`
- Modify: `apps/api/tests/migrations/test_weekly_quota_topup.py`
- Modify: `scripts/verify_rls.sql` (new Case 15)
- Modify: `apps/web/lib/investigations.ts`
- Modify: `apps/web/lib/__tests__/investigations.test.ts`
- Modify: `apps/web/components/verify/NewCheckForm.tsx`
- Create: `apps/web/components/verify/__tests__/NewCheckForm.test.tsx`

**Interfaces:**
- Consumes: `app_setting()`, `user_check_quota`, `investigations.quota_source`.
- Produces: `quota_status() returns table(weekly_used int, weekly_limit int, resets_at timestamptz, top_up_balance int)` (SECURITY DEFINER, `grant execute … to authenticated`). Web: `QuotaStatus = { weeklyUsed: number; weeklyLimit: number; resetsAt: string | null; topUpBalance: number }`.

- [ ] **Step 1: Write the failing DB test**

Append to `apps/api/tests/migrations/test_weekly_quota_topup.py`:

```python
STATUS = _sql("20260821130300_quota_status_weekly_topup.sql")


def test_quota_status_new_four_column_shape():
    assert "create or replace function quota_status()" in STATUS
    assert "returns table(weekly_used int, weekly_limit int, resets_at timestamptz, top_up_balance int)" in STATUS


def test_quota_status_security_definer_and_grant():
    assert "security definer" in STATUS
    assert "revoke all on function quota_status() from public" in STATUS
    assert "grant execute on function quota_status() to authenticated" in STATUS


def test_quota_status_counts_weekly_and_joins_balance():
    assert "quota_source = 'weekly'" in STATUS
    assert "left join user_check_quota" in STATUS


def test_verify_rls_has_quota_status_case():
    assert "case 15" in VERIFY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: FAIL — the four new tests fail. Earlier tests PASS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821130300_quota_status_weekly_topup.sql`:

```sql
-- Read side of the two-bucket quota (spec §4.2). Returns both buckets so the
-- UI shows "N of 3 weekly left · resets <date>" plus "+M bonus checks" and
-- disables submit only when both are empty. Mirrors enforce_check_quota()
-- exactly (same 'weekly' filter + settings). security definer so the count is
-- over the caller's own rows via auth.uid(); balance via left join (0 if none).
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
```

- [ ] **Step 4: Run DB test to verify it passes**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: PASS except `test_verify_rls_has_quota_status_case` (Case 15 next).

- [ ] **Step 5: Add behavioral Case 15 to `verify_rls.sql`**

Insert before the final `rollback;`:

```sql
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
  insert into auth.users (id, email) values (u, 'status@example.com');
  perform grant_top_up(u, 4);
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

  delete from auth.users where id = u;
  raise notice 'Case 15 PASS';
end $$;
```

- [ ] **Step 6: Run migrations + behavioral check**

Run: `supabase db reset` then the `verify_rls.sql` psql command.
Expected: `Case 15 PASS`, no failures. Re-run pytest; `test_verify_rls_has_quota_status_case` PASSES.

- [ ] **Step 7: Write the failing web test (lib mapping)**

Replace the `QuotaStatus`-related expectations by adding to `apps/web/lib/__tests__/investigations.test.ts`:

```typescript
import { quotaStatus } from "../investigations";

describe("quotaStatus", () => {
  it("maps the four-column RPC row to the QuotaStatus shape", async () => {
    const client = {
      rpc: () => ({
        single: () =>
          Promise.resolve({
            data: { weekly_used: 2, weekly_limit: 3, resets_at: "2026-08-28T00:00:00Z", top_up_balance: 4 },
          }),
      }),
    } as any;
    const q = await quotaStatus(client);
    expect(q).toEqual({ weeklyUsed: 2, weeklyLimit: 3, resetsAt: "2026-08-28T00:00:00Z", topUpBalance: 4 });
  });

  it("falls back to safe defaults when the row is empty", async () => {
    const client = { rpc: () => ({ single: () => Promise.resolve({ data: null }) }) } as any;
    const q = await quotaStatus(client);
    expect(q).toEqual({ weeklyUsed: 0, weeklyLimit: 3, resetsAt: null, topUpBalance: 0 });
  });
});
```

- [ ] **Step 8: Run the web test to verify it fails**

Run: `cd apps/web && pnpm test -- investigations`
Expected: FAIL — `quotaStatus` still returns `{ used, limit, resetsAt }`, so the `toEqual` on the new shape fails.

- [ ] **Step 9: Update `apps/web/lib/investigations.ts`**

Replace the `QuotaStatus` type and `quotaStatus()` (lines 63–73):

```typescript
export type QuotaStatus = {
  weeklyUsed: number;
  weeklyLimit: number;
  resetsAt: string | null;
  topUpBalance: number;
};

export async function quotaStatus(client: Client): Promise<QuotaStatus> {
  // `quota_status` is a DB RPC not present in the hand-authored Database types;
  // cast narrowly (same pattern as the `as unknown as` casts elsewhere here).
  const { data } = await (client.rpc as unknown as (fn: string) => {
    single: () => Promise<{
      data: {
        weekly_used?: number;
        weekly_limit?: number;
        resets_at?: string | null;
        top_up_balance?: number;
      } | null;
    }>;
  })("quota_status").single();
  const row = data ?? {};
  return {
    weeklyUsed: row.weekly_used ?? 0,
    weeklyLimit: row.weekly_limit ?? 3,
    resetsAt: row.resets_at ?? null,
    topUpBalance: row.top_up_balance ?? 0,
  };
}
```

- [ ] **Step 10: Run the web test to verify it passes**

Run: `cd apps/web && pnpm test -- investigations`
Expected: PASS.

- [ ] **Step 11: Write the failing component test**

Create `apps/web/components/verify/__tests__/NewCheckForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NewCheckForm } from "../NewCheckForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../lib/supabase/client", () => ({ createClient: () => ({}) }));

const quotaMock = vi.fn();
vi.mock("../../../lib/investigations", () => ({
  quotaStatus: (...a: unknown[]) => quotaMock(...a),
  createInvestigation: vi.fn(),
}));

beforeEach(() => quotaMock.mockReset());

describe("NewCheckForm quota display", () => {
  it("shows weekly remaining and bonus count, submit enabled when bonus remains", async () => {
    quotaMock.mockResolvedValue({ weeklyUsed: 3, weeklyLimit: 3, resetsAt: "2026-08-28T00:00:00Z", topUpBalance: 4 });
    render(<NewCheckForm initialJobText="x" />);
    await waitFor(() => expect(screen.getByText(/0 of 3 weekly checks left/i)).toBeInTheDocument());
    expect(screen.getByText(/\+4 bonus checks/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run the check/i })).toBeEnabled();
  });

  it("disables submit only when weekly is exhausted AND balance is 0", async () => {
    quotaMock.mockResolvedValue({ weeklyUsed: 3, weeklyLimit: 3, resetsAt: "2026-08-28T00:00:00Z", topUpBalance: 0 });
    render(<NewCheckForm initialJobText="x" />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /run the check/i })).toBeDisabled(),
    );
  });
});
```

- [ ] **Step 12: Run the component test to verify it fails**

Run: `cd apps/web && pnpm test -- NewCheckForm`
Expected: FAIL — the component still reads `quota.limit`/`quota.used` (now `undefined`), renders the old copy, and computes `exhausted` from the wrong fields.

- [ ] **Step 13: Update `apps/web/components/verify/NewCheckForm.tsx`**

Update `resetCopy`, the derived state, and the quota line. Replace `resetCopy` (lines 21–25):

```tsx
function resetCopy(resetsAt: string | null, limit: number): string {
  if (!resetsAt) return `You’ve used all ${limit} weekly checks and have no bonus checks left. Your weekly quota resets soon.`;
  const d = new Date(resetsAt);
  return `You’ve used all ${limit} weekly checks and have no bonus checks left. Your weekly quota resets on ${d.toLocaleDateString()}.`;
}
```

Replace the derived state (lines 39–40):

```tsx
  const weeklyRemaining = quota ? Math.max(quota.weeklyLimit - quota.weeklyUsed, 0) : null;
  const topUp = quota?.topUpBalance ?? 0;
  // Blocked only when BOTH buckets are empty; a bonus check keeps submit live.
  const exhausted = quota ? weeklyRemaining === 0 && topUp === 0 : false;
```

Update the `onSubmit` exhausted branch (lines 70–73) and the quota-exceeded branch (line 78) to use `quota?.weeklyLimit ?? 3`:

```tsx
    if (exhausted) {
      setFormError(resetCopy(quota?.resetsAt ?? null, quota?.weeklyLimit ?? 3));
      return;
    }
```
```tsx
        result.quotaExceeded
          ? resetCopy(result.resetsAt ?? null, quota?.weeklyLimit ?? 3)
          : "We couldn’t start the check. " + result.error,
```

Replace the quota line (lines 171–176):

```tsx
      {quota ? (
        <p className="text-[13px] leading-[1.5] text-ink-soft">
          {weeklyRemaining} of {quota.weeklyLimit} weekly checks left
          {quota.resetsAt ? ` · resets ${new Date(quota.resetsAt).toLocaleDateString()}` : ""}
          {topUp > 0 ? ` · +${topUp} bonus checks` : ""}
        </p>
      ) : null}
```

(The submit `disabled={exhausted}` on line 185 now reflects both-buckets-empty via the updated `exhausted`.)

- [ ] **Step 14: Run the web tests to verify they pass**

Run: `cd apps/web && pnpm test -- NewCheckForm investigations`
Expected: PASS. Then run the full suite `cd apps/web && pnpm test` to catch regressions in other tests that touch `NewCheckForm`/`QuotaStatus`.

- [ ] **Step 15: Commit**

```bash
git add apps/api/tests/migrations/test_weekly_quota_topup.py supabase/migrations/20260821130300_quota_status_weekly_topup.sql scripts/verify_rls.sql apps/web/lib/investigations.ts apps/web/lib/__tests__/investigations.test.ts apps/web/components/verify/NewCheckForm.tsx apps/web/components/verify/__tests__/NewCheckForm.test.tsx
git commit -m "feat(web): quota_status two-bucket shape + weekly/bonus UI

Claude-Session: https://claude.ai/code/session_01S59Fmci1gdtQJM7hQo6S12"
```

---

## Task E: `grant_top_up()` admin RPC + operator docs

**Files:**
- Create: `supabase/migrations/20260821130400_grant_top_up.sql`
- Modify: `apps/api/tests/migrations/test_weekly_quota_topup.py`
- Modify: `scripts/verify_rls.sql` (new Case 16)
- Modify: `scripts/RUNBOOK.md`

**Interfaces:**
- Consumes: `user_check_quota` (Task B).
- Produces: `grant_top_up(target_user uuid, n int) returns int` (SECURITY DEFINER, `service_role` only) — atomic add-to-balance; the `>= 0` check floors claw-backs. Already used by Cases 14/15; this task lands the function and its own tests + docs.

> Note: Cases 14 and 15 call `grant_top_up()`. If executing strictly task-by-task, those cases only pass once this migration is applied. Either land Task E's migration before re-running the Task C/D behavioral checks, or (simpler) run the full `verify_rls.sql` once at the end — every case is idempotent and self-cleaning.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/migrations/test_weekly_quota_topup.py`:

```python
GRANT = _sql("20260821130400_grant_top_up.sql")


def test_grant_top_up_is_definer_service_role_only():
    assert "create or replace function grant_top_up(target_user uuid, n int)" in GRANT
    assert "security definer" in GRANT
    assert "revoke all on function grant_top_up(uuid, int) from public, anon, authenticated" in GRANT
    assert "grant execute on function grant_top_up(uuid, int) to service_role" in GRANT


def test_grant_top_up_upserts_and_adds():
    assert "on conflict (user_id) do update" in GRANT
    assert "user_check_quota.top_up_balance + excluded.top_up_balance" in GRANT


def test_verify_rls_has_grant_case():
    assert "case 16" in VERIFY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: FAIL — the three new tests fail. Earlier tests PASS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821130400_grant_top_up.sql`:

```sql
-- Operator/admin grant of top-up checks (spec §4.7). service_role only — this
-- is the seam a future purchase/billing flow would credit into. Atomic upsert;
-- n may be negative to claw back, floored by the >= 0 check on the column (a
-- claw-back below zero raises rather than going negative).
create or replace function grant_top_up(target_user uuid, n int)
returns int language plpgsql security definer
set search_path = public
as $$
declare new_balance int;
begin
  insert into user_check_quota (user_id, top_up_balance)
  values (target_user, n)
  on conflict (user_id) do update
    set top_up_balance = user_check_quota.top_up_balance + excluded.top_up_balance,
        updated_at = now()
  returning top_up_balance into new_balance;
  return new_balance;
end $$;

revoke all on function grant_top_up(uuid, int) from public, anon, authenticated;
grant execute on function grant_top_up(uuid, int) to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v`
Expected: PASS except `test_verify_rls_has_grant_case` (Case 16 next).

- [ ] **Step 5: Add behavioral Case 16 to `verify_rls.sql`**

Insert before the final `rollback;`:

```sql
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
```

- [ ] **Step 6: Full migration + behavioral run**

Run: `supabase db reset`
Then: `psql "$(supabase status -o json | jq -r '.DB_URL')" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql`
Expected: `Case 9`…`Case 16` all PASS, no failures.
Then: `cd apps/api && pytest tests/migrations/test_weekly_quota_topup.py -v` — all PASS.

- [ ] **Step 7: Document operator setup in `scripts/RUNBOOK.md`**

Add a section (near the existing quota/settings docs) covering:

```markdown
### Quota settings & top-ups (app_settings)

The quota knobs live in the `app_settings` table (not GUCs, not .env — the DB
trigger cannot read the web env). Edit them live, no deploy:

```sql
update app_settings set value = '5' where key = 'check_quota_limit';        -- weekly allowance
update app_settings set value = '7' where key = 'check_quota_window_days';  -- rolling window
update app_settings set value = '3' where key = 'default_top_up_balance';   -- bonus for NEW signups
```

`default_top_up_balance` applies to accounts created *after* the change; it does
not rewrite existing balances.

Grant (or claw back) bonus checks for one account as `service_role`:

```sql
select grant_top_up('<user-uuid>', 10);   -- add 10 bonus checks; returns new balance
select grant_top_up('<user-uuid>', -5);   -- claw back 5 (raises if it would go below 0)
```

Bonus checks never refresh; they are spent only after the weekly allowance is
used up.
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/tests/migrations/test_weekly_quota_topup.py supabase/migrations/20260821130400_grant_top_up.sql scripts/verify_rls.sql scripts/RUNBOOK.md
git commit -m "feat(db): grant_top_up admin RPC + operator docs

Claude-Session: https://claude.ai/code/session_01S59Fmci1gdtQJM7hQo6S12"
```

---

## Self-Review

**1. Spec coverage:**
- §4.1 two-bucket enforce (weekly-first, top-up, PT429, stamp, definer, FOR UPDATE, null-uid guard) → Task C.
- §4.2 quota_status 4-column shape + web UX (weekly + bonus copy, disable only when both empty, error mapping) → Task D.
- §4.7 `user_check_quota` + RLS → Task B; provisioning + backfill → Task B; `app_settings` + `app_setting()` → Task A; `grant_top_up()` → Task E.
- §5 migration list (all five files, `quota_source` column, CREATE OR REPLACE) → Tasks A–E.
- §7 operator config (app_settings edits, grant_top_up, default_top_up_balance) → Task E Step 7.
- §8 testing (migration text-assertions, verify_rls behavioral incl. double-spend + claw-back + service-role-only, vitest) → Tasks A–E.
- §9a phases A–E → Tasks A–E one-to-one.
- §10 risk (historical NULL `quota_source`) → accepted; Case 9 seeds updated to `weekly` (Task C Step 5) so behavioral checks stay valid.

**2. Placeholder scan:** No TBD/TODO; every SQL, TS, and test step contains full content.

**3. Type consistency:** `QuotaStatus` fields (`weeklyUsed`, `weeklyLimit`, `resetsAt`, `topUpBalance`) match between `investigations.ts` (Task D Step 9), its test (Step 7), and `NewCheckForm.tsx` (Step 13). RPC columns (`weekly_used`, `weekly_limit`, `resets_at`, `top_up_balance`) match between the migration (Task D Step 3), the DB test (Step 1), Case 15 (Step 5), and the lib mapping (Step 9). `grant_top_up(uuid, int)` signature matches between migration (Task E Step 3), tests (Step 1), and Cases 14/15/16.

**Cross-task dependency note:** `grant_top_up()` (Task E) is used by Cases 14 & 15 (Tasks C & D). Executors running strictly per-task should run the complete `verify_rls.sql` once after Task E (all cases idempotent/self-cleaning), or apply Task E's migration before re-verifying C/D — called out in Task E's intro note.
