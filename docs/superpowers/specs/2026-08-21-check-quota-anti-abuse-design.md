# Check Quota & Anti-Abuse — Design

**Date:** 2026-08-21
**Status:** Draft for review
**Amended:** 2026-08-21 — weekly window (7d, was rolling 14d), a **non-refreshing
per-account top-up balance** in addition to the weekly allowance, and a runtime
**`app_settings` table** as the config home (replacing the `app.settings.*` GUCs
for the quota knobs). See §4.1, §4.2, §4.7, §5, §7–§9.
**Related:**
- `docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md` (worker, schema, RLS)
- `docs/superpowers/specs/2026-08-19-v1-web-supabase-integration-design.md` (auth, direct-insert flow)

## 1. Goal

Make the checker free but abuse-resistant: **every authenticated user gets 3
checks per rolling 7-day window** (the recurring free allowance), **plus an
optional per-account top-up balance of extra checks that never refreshes** (a
persistent grant, consumed only after the weekly allowance is spent), and no
bot — single account or account farm — can turn the checker into a money pump.

The weekly allowance is **use-it-or-lose-it**: it does not accumulate across
weeks (a rolling window ages each use out exactly 7 days later; unused capacity
never stacks past the limit). The top-up balance is the opposite — it is a
one-time grant that sits untouched until the weekly allowance runs out, and what
is left carries forward indefinitely until spent.

### Non-goals
- No anonymous tier. Search is already auth-gated (Supabase Auth); `user =
  auth.uid()`. This spec does not add anonymous access.
- No paid/billing tier. The weekly 3 is the hard *recurring* ceiling; the
  top-up balance is a manually granted (admin/service-role) allotment, not a
  purchase flow. A monetized purchase path is out of scope, but the top-up
  balance is the seam a future one would credit into — no schema change needed.
- No self-serve top-up. Balances are granted by an operator (`grant_top_up()`,
  §4.7) or seeded for new accounts via `default_top_up_balance`; users cannot
  grant themselves credits.
- No CAPTCHA/Turnstile. Because there is no anonymous entry point, the
  signup gate (email confirmation) plus the quota carry the anti-bot load.

## 2. Threat model

The checker fans every submission out into multiple LLM calls + Tavily
searches + page fetches — real dollars per request. The SSRF guard already
prevents the fetcher being used as an internal-network proxy
(`apps/api/src/app/tools/fetcher.py`), so the residual abuse is **cost /
capacity exhaustion**, in two forms:

| Vector | Control |
|---|---|
| One account hammering the checker | **Per-user rolling quota** (§4.1) |
| An **account farm** — many signups, 3 checks each | **Signup gate** (§4.4) + **global daily cost ceiling** (§4.3) + **observability** (§4.5) |
| A single crafted input running away in cost | **Hard per-investigation cost cap** (§4.3) |

**Why per-user quota alone is not enough:** a 3/account limit bounds *per
account* spend but a bot farms accounts. The quota is the fairness/primary
control; the signup gate, global ceiling, and observability are what actually
bound total financial exposure. All four ship together — scope (c).

## 3. Enforcement architecture

The V1 web client **inserts an `investigations` row directly into Supabase
via PostgREST**, guarded by RLS `with check (user_id = auth.uid())`; a
`BEFORE INSERT` trigger (`force_investigation_defaults`) locks server-owned
columns and an `AFTER INSERT` trigger emits the worker webhook. **There is no
application server in the insert path.**

Consequence: **quota and signup enforcement must live in the database**, or
they are advisory. Cost enforcement, which needs the post-run spend figure,
lives in the **worker** (the only component that knows a run's cost). So:

- **Database** — per-user quota (trigger on `investigations`), disposable-email
  block (trigger on `auth.users`), quota-status RPC, observability views.
- **Worker** (`apps/api/src/app/worker/`) — global daily ceiling + hard
  per-investigation cap, checked before/around the graph run.
- **Web** — reads quota status, renders remaining/reset, maps the quota error.

## 4. Components

### 4.1 Two-bucket quota — `enforce_check_quota()` trigger

A `BEFORE INSERT` trigger function on `investigations`, replacing the
rolling-window-only version (`CREATE OR REPLACE` in a new migration). Runs
after RLS `with check` passes and alongside the existing `before insert`
triggers (fire order is alpha by name; the quota reads a count and writes the
caller's own `user_check_quota` row, so order versus `force_investigation_
defaults` is immaterial).

Two buckets are charged in a fixed order — **weekly allowance first, top-up
balance second** — and the check is **stamped with the bucket it drew from**
(`NEW.quota_source ∈ {'weekly','top_up'}`) so the read side (§4.2) and future
rounds can tell weekly usage apart from top-up usage. Without the stamp, a
top-up-funded row would be indistinguishable from a weekly one in the rolling
count, and the two buckets could not coexist.

Logic:
```
if auth.uid() is null: return NEW                       -- service/worker, unmetered (see below)
lim := app_setting('check_quota_limit', '3')::int       -- §4.7 settings table, with code default
win := app_setting('check_quota_window_days', '7')::int

weekly_used := count(*) from investigations
               where user_id = auth.uid()
                 and quota_source = 'weekly'
                 and created_at > now() - (win || ' days')::interval

if weekly_used < lim:
    NEW.quota_source := 'weekly'
    return NEW

-- weekly allowance spent → fall through to the permanent balance
select top_up_balance into bal
  from user_check_quota where user_id = auth.uid() for update   -- row-lock: no double-spend across concurrent inserts
if bal > 0:
    update user_check_quota
       set top_up_balance = top_up_balance - 1, updated_at = now()
     where user_id = auth.uid()
    NEW.quota_source := 'top_up'
    return NEW

-- both buckets exhausted
resets_at := (min(created_at) of the in-window 'weekly' rows) + win days
RAISE LOG  'check_quota_denied user=% weekly_used=% limit=% top_up=%', auth.uid(), weekly_used, lim, bal
RAISE sqlstate 'PT429'
  using message = 'check_quota_exceeded',
        hint    = to_char(resets_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
```

Design decisions:
- **Rolling 7-day window** for the weekly bucket, not a calendar reset. It
  needs no cron, ages out naturally (each use frees its slot exactly 7 days
  later), and cannot be gamed at a boundary (a fixed date lets a user burn 3
  at 23:59 and 3 more at 00:01). The reset moment shown to the user is
  `oldest-in-window 'weekly' row + 7 days` — i.e. when the next *weekly* slot
  frees. The **top-up balance never refreshes**, so it contributes nothing to
  `resets_at`.
- **Weekly-first charge order.** The recurring allowance is use-it-or-lose-it,
  so spending it before the permanent balance wastes the least — the granted
  top-up is preserved as long as possible.
- **`quota_source` stamps every metered insert.** Weekly-used counts only
  `quota_source='weekly'` rows; top-up spend is tracked by the balance
  counter, not by counting rows. Service/worker rows stay `NULL` (unmetered).
- **`SECURITY DEFINER`.** The trigger now *writes* `user_check_quota`
  (decrementing the balance), which is RLS-protected against client writes, so
  the function runs as its owner with a pinned `search_path`. It still keys all
  reads/writes off `auth.uid()` (the JWT claim resolves under a definer
  context), so a user can only ever spend their own balance.
- **`FOR UPDATE` on the balance row** prevents two concurrent inserts from the
  same user both reading `bal=1` and both succeeding (double-spend). The lock
  is held only for the row being decremented.
- **Every submission counts**, regardless of terminal status. Every insert
  triggers the pipeline, so counting only successes would let crafted-to-fail
  inputs run free. Operators refund a weekly slot by deleting the row (service
  role bypasses RLS and this trigger) and/or re-crediting via `grant_top_up()`.
- **Limit/window come from the `app_settings` table** (§4.7) via the
  `app_setting(key, default)` helper, with code defaults `3`/`7` so an unseeded
  environment still works. Change them with a single `UPDATE app_settings …`,
  no deploy and no `alter database`.
- **`PT429`**: PostgREST maps a `PTxyz` SQLSTATE to HTTP status `xyz`, so the
  client receives **HTTP 429** with `{code:"PT429", message:"check_quota_
  exceeded", hint:<resets_at>}`. The client matches on `message`, so UX does
  not hard-depend on the status; the 429 is verified by test (§8).
- **Service role / worker inserts bypass** — the worker connects as the DB
  owner / service role; `auth.uid()` is null for a service connection, so the
  `auth.uid() is null` guard returns early and the row is left unmetered
  (`quota_source` NULL). The worker only ever *updates* `investigations`, never
  inserts, so this is a future-proofing guard rather than a live path.

### 4.2 Quota status — `quota_status()` RPC + client UX

A `SECURITY DEFINER` SQL function, `grant execute … to authenticated`,
returning the caller's full quota state — both buckets — so the UI never has to
reverse-engineer it from a raw insert error. **The return shape changes** (adds
`top_up_balance`, renames `used`/`limit` to `weekly_*` for clarity), so the web
consumers in §4.2 update in lockstep:
```
quota_status() -> table(
  weekly_used     int,          -- count of in-window quota_source='weekly' rows
  weekly_limit    int,          -- app_setting('check_quota_limit','3')
  resets_at       timestamptz,  -- oldest in-window 'weekly' row + window; null when weekly_used = 0
  top_up_balance  int           -- user_check_quota.top_up_balance, 0 if no row
)
```
`weekly_used`/`weekly_limit`/`resets_at` mirror §4.1 exactly (same
`quota_source='weekly'` filter and settings); `top_up_balance` is a
`left join user_check_quota` coalesced to 0. Reads only the caller's rows via
`auth.uid()`.

Web (`/verify`), all in `apps/web/lib/investigations.ts::quotaStatus()` +
`NewCheckForm.tsx`:
- Update the `QuotaStatus` type and the RPC mapping to the new columns
  (`weeklyUsed`, `weeklyLimit`, `resetsAt`, `topUpBalance`).
- On load, render "**N of 3 weekly checks left · resets <date>**", and, when
  `top_up_balance > 0`, an additional "**+M bonus checks**".
- **Disable the submit button only when `weekly_used >= weekly_limit` AND
  `top_up_balance = 0`** — i.e. only when *both* buckets are empty. A user with
  weekly exhausted but bonus remaining can still submit (it spends a bonus).
- Still handle the insert rejection defensively: HTTP 429 or `message ===
  'check_quota_exceeded'` → show the reset message (covers the race where a
  second tab spends the last slot in either bucket). The `createInvestigation`
  PT429 mapping is unchanged.

### 4.3 Global daily cost ceiling (worker)

**Global daily ceiling.** New config `settings.global_daily_usd_ceiling`
(env `GLOBAL_DAILY_USD_CEILING`, default `25.00`). In
`worker/functions.py::handle_requested`, **after** the cache-hit check (cache
hits are free and must not be blocked) and **before** `set_status('running')`
/ the graph run, query the day's spend via a new persistence method
`day_spend_usd()`:
```
select coalesce(sum((cost->>'total_usd')::numeric), 0)
from investigations
where created_at >= date_trunc('day', now() at time zone 'utc')
```
If `>= ceiling`, short-circuit: mark the investigation terminal **`failed`**
and write a cost marker `{"total_usd":0,"by_node":{},"capacity_blocked":true}`
(a new `persistence.mark_capacity_blocked()`), then **do not run the graph**.
The client renders it through its existing `failed` state; detecting the
`capacity_blocked` marker to show capacity-specific copy ("we've hit today's
capacity, try again tomorrow") is optional polish. This is the emergency brake
against account-farm spend that slips the per-account cap.

**On the per-investigation tail (deliberately not a mid-run abort).** A single
run's cost is already bounded by the per-call `llm_timeout_s` and
`branch_timeout_s`, and a runaway run is caught at day granularity by the
global ceiling above (the *next* insert is refused once the day crosses the
ceiling). A mid-stream cost abort would require interrupting the LangGraph
`astream_events` loop — disproportionate complexity for a tail the ceiling
already covers (YAGNI). We keep `cost_tracker`'s existing `over_budget` alert
(`BUDGET_ALERT_USD = 0.30`) as an *observed* signal surfaced in §4.5, not an
enforced abort.

### 4.4 Signup gate — disposable-email block + email confirmation

**Email confirmation (config prerequisite, no code).** Supabase Auth "Confirm
email" **ON**: an unconfirmed user never receives a session/access token, so
they can never obtain `auth.uid()` and can never insert. Document this as a
hard operator prerequisite; add a check to `scripts/verify_rls.sql` notes.
Prefer Google OAuth as the higher-trust path (no inbox to farm).

**Disposable-email block.** A `blocked_email_domains` table + a `BEFORE
INSERT` trigger `reject_disposable_email()` on `auth.users` (the standard
Supabase pattern of triggering on `auth.users`). On signup, extract the email
domain; if it is in `blocked_email_domains`, `RAISE sqlstate 'PT422' using
message = 'email_domain_not_allowed'`. Seed the table from a maintained
disposable-domain list (checked-in seed migration; operator refreshes
periodically). Service-role user creation bypasses (admin invites still work).

### 4.5 Abuse observability

Lightweight, operator-facing — no new service:
- **`abuse_daily_spend`** view: `date`, `investigation_count`, `total_usd`
  from `investigations` grouped by UTC day.
- **`abuse_signups_hourly`** view: `hour`, `signups` from `auth.users`
  grouped by hour (flags farm bursts).
- **Denial log lines**: the §4.1 trigger `RAISE LOG`s each quota denial (a
  `RAISE LOG` survives the transaction rollback that the accompanying
  `RAISE EXCEPTION` causes, so denials are observable in Postgres logs even
  though no row is written).
- **`abuse_snapshot()`** `SECURITY DEFINER` function (grant to a monitoring
  role only) returning today's spend, ceiling headroom, and last-24h signup
  count, for a scheduled operator alert. Wiring the alert destination is out
  of scope (operator task).

### 4.6 Rate limiting — delegated, not implemented

Per-user request rate limiting on the **check** endpoint is intentionally
**omitted**: the two-bucket quota (§4.1) is a far tighter cap on the expensive
path — even a full weekly-plus-top-up allowance fired in one second is a small,
bounded number of runs — so a velocity limit on top adds nothing. Rate limiting is instead handled where the quota does *not*
meter:

- **Signup / login velocity** (the account-farm vector) → **Supabase Auth's
  built-in rate limits** (dashboard → Auth → Rate Limits), tuned down. Config,
  not code. This is the primary control on farm creation speed.
- **`quota_status()` and other reads** → cheap (one indexed count, no LLM
  spend); if needed, a coarse per-IP limit at the **edge/WAF**, not in-app.
- **Raw request / connection floods (L7)** → **edge/WAF** (e.g. Cloudflare).

No application-level rate limiter is built as part of this work.

### 4.7 Top-up balance, settings table, and granting

**`user_check_quota` — the permanent balance.** One row per account:
```
user_check_quota(
  user_id        uuid primary key references auth.users(id) on delete cascade,
  top_up_balance int  not null default 0 check (top_up_balance >= 0),
  updated_at     timestamptz not null default now()
)
```
RLS on: a `select` policy `using (user_id = auth.uid())` (so `quota_status()`
and any future client read see only the caller's balance); **no** client
insert/update/delete policy — the balance moves only through the
`SECURITY DEFINER` trigger (decrement, §4.1) and `grant_top_up()` (credit).

**Provisioning.** An `AFTER INSERT` trigger on `auth.users`
(`provision_user_quota()`) inserts a `user_check_quota` row with
`top_up_balance = app_setting('default_top_up_balance','0')::int`. The migration
**backfills** existing users with the same default. `default_top_up_balance` is
read at *provision time*, so changing the setting affects only accounts created
afterward — existing balances are never rewritten by a setting change (correct
grant semantics; a retroactive grant is an explicit operator `UPDATE` /
`grant_top_up()`, not a side effect of editing config). The §4.1 trigger also
treats a missing row as `balance = 0`, so a provisioning gap fails safe (denies
top-up) rather than erroring.

**`app_settings` — the config home.** A key/value table read at trigger/RPC
time, replacing the `app.settings.*` GUCs for the quota knobs:
```
app_settings(
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
)
-- seeded rows:
--   check_quota_limit        = '3'
--   check_quota_window_days  = '7'
--   default_top_up_balance   = '0'

app_setting(k text, d text) returns text          -- SECURITY DEFINER, STABLE
  := coalesce((select value from app_settings where key = k), d)
```
RLS on with no client policy; the definer functions read it, `service_role`
writes it. Operators tune the whole system from one place —
`update app_settings set value = '5' where key = 'check_quota_limit'` — with no
deploy and no `alter database`. Code-level defaults in every `app_setting(k, d)`
call mean an unseeded/empty table still works.

> **Why a table, not `.env`.** Enforcement runs *inside Postgres* (the trigger),
> which cannot read the web app's `.env`. The DB needs a DB-readable source of
> truth; `app_settings` is it, and it doubles as the single settings home the
> product wanted ("multiple settings for the whole app"). Seeding the table from
> environment at deploy time is an optional ops convenience (a one-line
> idempotent `insert … on conflict do update`), not a second source of truth —
> out of scope here.

**Granting top-ups.** A `SECURITY DEFINER` RPC, executable by `service_role`
only (revoked from `authenticated`/`public`), so credits can be added
atomically without a raw table write:
```
grant_top_up(target_user uuid, n int) returns int   -- new balance
  := insert into user_check_quota (user_id, top_up_balance)
       values (target_user, greatest(n, 0))            -- speculative-check-safe floor
     on conflict (user_id) do update
       set top_up_balance = user_check_quota.top_up_balance + n,  -- real arithmetic, using n not excluded
           updated_at = now()
     returning top_up_balance
```
`n` may be negative to claw back. Note the shape: Postgres validates the
`check (top_up_balance >= 0)` constraint against the raw `VALUES` tuple during
`INSERT … ON CONFLICT`'s speculative-insert phase (before conflict resolution),
and CHECKs are not deferrable — so a literal negative `n` in `VALUES` raises
even when the update would net non-negative. Hence `greatest(n,0)` in `VALUES`
(safe on the no-conflict path; a brand-new row cannot be clawed below 0) and the
real `+ n` arithmetic in `DO UPDATE` (using the parameter, not
`excluded.top_up_balance`, which equals the floored value). The final updated
row is still checked, so `existing + n < 0` raises `check_violation` as
intended. This is the seam a future purchase/billing flow credits into.

## 5. Data model changes

The original quota/anti-abuse migrations (`20260821120000`–`20260821123000`)
have **already shipped**. This amendment lands as **new, appended migrations**
(the applied files are immutable), using `CREATE OR REPLACE` for the two
functions and additive `ALTER`/`CREATE` for the rest. All changes are additive
or in-place replacements; nothing is dropped.

New objects (timestamped after the existing quota migrations, e.g.
`20260821130000_weekly_quota_topup.sql`):

- `app_settings(key text pk, value text not null, updated_at)` + seed rows
  (`check_quota_limit='3'`, `check_quota_window_days='7'`,
  `default_top_up_balance='0'`) + `app_setting(k, d)` helper (§4.7). RLS on,
  no client policy.
- `user_check_quota(user_id uuid pk → auth.users on delete cascade,
  top_up_balance int not null default 0 check (>=0), updated_at)` + RLS
  (`select` own only) (§4.7).
- `investigations`: **add** `quota_source text check (quota_source in
  ('weekly','top_up'))` (nullable; NULL = unmetered service row). The existing
  `investigations_user_created_idx (user_id, created_at)` stays; the weekly
  count additionally filters `quota_source='weekly'` — covered by that index
  (the extra predicate is a cheap filter over the already-narrow per-user slice;
  a partial/extended index is unnecessary at this volume).
- `enforce_check_quota()` — `CREATE OR REPLACE`, now two-bucket + `SECURITY
  DEFINER` (§4.1). Existing `before insert` trigger binding is reused.
- `quota_status()` — `CREATE OR REPLACE` with the new 4-column shape (§4.2).
- `provision_user_quota()` + `after insert` trigger on `auth.users`, plus a
  one-time backfill of existing users (§4.7).
- `grant_top_up(target_user uuid, n int)` `SECURITY DEFINER`, `service_role`
  only (§4.7).
- **Unchanged** from the shipped migrations: `blocked_email_domains` + seed +
  `reject_disposable_email()`; the `abuse_*` views + `abuse_snapshot()`; the
  emit webhook and its `app.settings.emit_investigation_*` GUCs (secrets — they
  stay GUCs, out of scope for the settings table).

## 6. Error contract

| Condition | HTTP | Body `message` | Client behavior |
|---|---|---|---|
| Over quota | 429 (`PT429`) | `check_quota_exceeded` (hint=resets_at) | Show reset copy; keep submit disabled |
| Disposable email at signup | *generic GoTrue signup error* (see note) | *GoTrue-wrapped, not `email_domain_not_allowed`* | Account not created; form shows a generic "couldn't sign up — use a permanent email" hint |
| Global capacity hit | investigation terminal `failed` + cost marker `capacity_blocked` | — | Existing `failed` state (capacity copy optional) |

> **Disposable-email note:** the `reject_disposable_email()` trigger raises
> `PT422`/`email_domain_not_allowed`, but sign-up goes through **GoTrue**, not
> PostgREST, so the `PTxyz`→HTTP mapping does **not** apply — GoTrue returns a
> generic signup failure (typically 500 "Database error saving new user") and
> the account is **not** created. The anti-farm guarantee holds (no account →
> no session → no `auth.uid()` → no checks); only the *precise* client copy is
> not derivable from the response. A clean 422 with `email_domain_not_allowed`
> would require a **pre-signup check** (Edge Function / RPC the form calls
> before `signUp`) reading `blocked_email_domains`, with the trigger kept as the
> authoritative backstop. Deferred; see RUNBOOK §6.

## 7. Config & operator setup

- Python: `GLOBAL_DAILY_USD_CEILING` in
  `apps/api/src/app/config.py` (+ `.env.example`, `apps/api/.env.example`).
- DB quota knobs — now the **`app_settings` table**, not GUCs:
  `update app_settings set value = '5' where key = 'check_quota_limit';`
  (keys: `check_quota_limit`=3, `check_quota_window_days`=7,
  `default_top_up_balance`=0 — all optional; code defaults baked in).
- Granting bonus checks: `select grant_top_up('<user-uuid>', 10);` as
  `service_role` (negative `n` claws back). Setting a nonzero
  `default_top_up_balance` gives every *future* signup that many bonus checks.
- Supabase dashboard: Auth → "Confirm email" **ON**; enable Google OAuth.
- RUNBOOK: editing `app_settings`; granting/clawing top-ups; refreshing
  `blocked_email_domains`; reading `abuse_*` views.

## 8. Testing strategy

Matches this repo's existing harness (`apps/api/tests/migrations/` asserts on
migration **SQL text**; behavioral DB checks live in the operator-run
`scripts/verify_rls.sql`; worker logic has real Python unit tests against the
in-memory/mock persistence used in `apps/api/tests/worker/`).

- **DB (quota, disposable-email, views)** — TDD via failing *text-assertion*
  tests in `apps/api/tests/migrations/` (trigger present; reads
  `app.settings.check_quota_limit`; 14-day interval; `PT429` +
  `check_quota_exceeded`; guards `auth.uid() is null`; index present;
  `auth.users` trigger + seed present). **Plus** new behavioral cases in
  `scripts/verify_rls.sql`: user A's 4th insert in-window is rejected; user
  B unaffected; a row >14 days old does not count; service role bypasses;
  blocked-domain signup rejected.
- **`quota_status()`** — verify_rls.sql case asserting `used/limit/resets_at`
  for a seeded 2-of-3 user; web component test for the disabled-at-0 state and
  the 429/`check_quota_exceeded` mapping.
- **Worker ceiling** — real Python unit tests: over-ceiling short-circuits to
  `failed` + `capacity_blocked` without running the graph; under-ceiling runs
  normally.
- **Config** — `tests/test_config.py` reads `global_daily_usd_ceiling` default.

**Amendment (weekly + top-up + settings table) — additional coverage:**
- **Migration text-assertions** (`apps/api/tests/migrations/`): `app_settings`
  table + seed + `app_setting()` helper; `user_check_quota` table + `>= 0`
  check + RLS; `investigations.quota_source` column + check constraint;
  `enforce_check_quota()` charges weekly-first, decrements `top_up_balance`
  under `for update`, stamps `quota_source`, is `SECURITY DEFINER`, reads the
  7-day window from `app_setting`; `quota_status()` returns the 4-column shape;
  `provision_user_quota()` trigger on `auth.users` + backfill; `grant_top_up()`
  `service_role`-only grant.
- **Behavioral (`scripts/verify_rls.sql`)**: user with balance 2 —
  submissions 1–3 stamp `weekly`, 4–5 stamp `top_up` and decrement balance to
  0, 6th raises `PT429`; a `weekly` row aged past 7 days frees a weekly slot
  (next insert stamps `weekly` again, balance untouched); `quota_status()`
  reports `weekly_used`/`top_up_balance` correctly through that sequence;
  `grant_top_up()` adds to the balance and a claw-back below 0 raises;
  provisioning gives a new user `default_top_up_balance`; service-role insert
  stays unmetered (`quota_source` NULL, balance untouched).
- **Web (vitest)**: `NewCheckForm` renders weekly + "+M bonus" copy; submit is
  disabled only when weekly is exhausted **and** balance is 0; enabled when
  bonus remains; the updated `quotaStatus()` maps the 4 new columns; the
  `check_quota_exceeded`/429 mapping still holds.
- **Concurrency note**: the `for update` double-spend guard is asserted in
  `verify_rls.sql` by two serialized transactions racing on a balance of 1
  (only one succeeds); a text-assertion also pins the `for update` clause so a
  refactor that drops it is caught.

## 9. Implementation phases (TDD; testing folded in; ≤6)

> **Phases 1–5 below shipped** as migrations `20260821120000`–`20260821123000`
> and their tests. The amendment (this revision) is delivered as the additional
> phases in **§9a**; the original phases are retained for provenance.

**Phase 1 — Per-user rolling quota (DB).**
Red: migration text-assertion tests for `enforce_check_quota()` (window,
setting, `PT429`, null-uid guard) + the `user_created` index — fail (no
migration). Green: write the migration. Add verify_rls.sql behavioral cases
(4th-rejected, B-unaffected, >14d-ages-out, service-role-bypass) and confirm
against a local `supabase db reset`.

**Phase 2 — Quota status RPC + client UX.**
Red: text-assertion test for `quota_status()` + grant; web component test
expecting submit disabled at `used=3` and the 429/`check_quota_exceeded` →
reset-copy mapping — fail. Green: add the function/grant; wire `/verify` to
call it, render remaining/reset, disable at limit, map the error.

**Phase 3 — Global daily ceiling (worker).**
Red: worker unit tests — over-ceiling ⇒ `failed` + `capacity_blocked`, graph
not run; under-ceiling ⇒ runs normally; config test for
`global_daily_usd_ceiling` — fail. Green: add the setting, the persistence
`day_spend_usd()`/`mark_capacity_blocked()` methods, and the
`handle_requested` short-circuit.

**Phase 4 — Signup gate (disposable-email block + confirmation).**
Red: text-assertion tests for `blocked_email_domains` + seed +
`reject_disposable_email()` trigger on `auth.users` (`PT422`) — fail. Green:
write the trigger + seed migration; add the verify_rls.sql blocked-domain
case; document "Confirm email ON" + Google OAuth as prerequisites in RUNBOOK.

**Phase 5 — Abuse observability.**
Red: text-assertion tests for `abuse_daily_spend`, `abuse_signups_hourly`,
`abuse_snapshot()`; a test asserting the quota trigger emits `RAISE LOG` on
denial — fail. Green: add the views/function and the log line; verify_rls.sql
aggregate case over seeded rows.

## 9a. Amendment phases (weekly + top-up + settings table; TDD; ≤6)

**Phase A — Settings table.**
Red: migration text-assertions for `app_settings` (table, seed rows,
`app_setting(k,d)` helper, RLS-on/no-client-policy) — fail. Green: write the
migration; `verify_rls.sql` case reading a seeded key and a code-default
fallback for a missing key.

**Phase B — Top-up state + provisioning.**
Red: text-assertions for `user_check_quota` (table, `>= 0` check, `select`-own
RLS), `investigations.quota_source` column + check, `provision_user_quota()`
`after insert` trigger on `auth.users`, and the existing-user backfill — fail.
Green: write them; `verify_rls.sql` cases — new signup gets
`default_top_up_balance`; backfill populated existing users; a client cannot
update its own balance.

**Phase C — Two-bucket enforcement.**
Red: text-assertions that `enforce_check_quota()` (CREATE OR REPLACE) is
`SECURITY DEFINER`, reads `check_quota_limit`/`check_quota_window_days` via
`app_setting`, filters `quota_source='weekly'`, decrements `top_up_balance`
`for update`, and stamps `quota_source`; behavioral `verify_rls.sql` for the
weekly→top-up→`PT429` sequence, 7-day age-out, and the balance-of-1 race — fail.
Green: rewrite the function.

**Phase D — Quota status RPC + web UX.**
Red: text-assertion for the new 4-column `quota_status()`; vitest for
`NewCheckForm` (weekly + bonus copy, submit disabled only when both empty) and
the updated `quotaStatus()` mapping — fail. Green: rewrite the RPC; update
`apps/web/lib/investigations.ts` + `NewCheckForm.tsx`.

**Phase E — Granting + operator docs.**
Red: text-assertion that `grant_top_up()` exists, is `SECURITY DEFINER`, and is
executable by `service_role` only (revoked from `authenticated`); `verify_rls.sql`
add-then-clawback case (and a below-zero claw-back raising) — fail. Green: add
the RPC; document `app_settings` edits, `grant_top_up()`, and
`default_top_up_balance` in `scripts/RUNBOOK.md`.

## 10. Risks & trade-offs

- **Account farming remains theoretically possible** — the signup gate raises
  cost (confirmed inbox per 3 checks) but does not eliminate it; the global
  ceiling is the hard financial stop. Accepted: matches "free tool" intent.
- **Rolling window ≠ a friendly fixed reset date.** Mitigated by surfacing a
  concrete `resets_at` (oldest-in-window 'weekly' row + 7d).
- **Top-up spend is uncapped by the weekly limit** — a large operator grant (or
  a nonzero `default_top_up_balance` across many signups) increases exposure.
  Bounded by the global daily cost ceiling (§4.3), which is the hard financial
  stop regardless of how balances are granted. Grants are a deliberate operator
  action, so this is accepted.
- **Two writers on the balance** (trigger decrement + `grant_top_up`) — both go
  through row-level locks / atomic `on conflict` UPDATEs, and the `>= 0` check
  is the invariant backstop; no lost-update window.
- **`quota_source` on historical rows is NULL** for checks inserted before this
  migration. They therefore do not count toward the *weekly* bucket after
  deploy — a one-time, at-most-3-per-user under-count in the first window. Rows
  older than the 7-day window are irrelevant; the effect is negligible and
  self-heals within a week. (A backfill of recent rows to `'weekly'` is possible
  but not worth it.)
- **Trigger cost on the hot insert path** — one indexed `count(*)` over a
  low-volume, quota-capped table. Negligible; the `(user_id, created_at)`
  index covers it.
- **A global-ceiling day burns a user's quota slot** (the insert counted, the
  run was refused). Rare backstop; operators refund by deleting the row.
- **`PT429`/`PT422` depend on PostgREST's `PTxyz` status mapping** — asserted
  by test so a PostgREST behavior change is caught, and the client also
  matches on `message` as a fallback.
