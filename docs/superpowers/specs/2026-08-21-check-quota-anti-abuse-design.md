# Check Quota & Anti-Abuse — Design

**Date:** 2026-08-21
**Status:** Draft for review
**Related:**
- `docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md` (worker, schema, RLS)
- `docs/superpowers/specs/2026-08-19-v1-web-supabase-integration-design.md` (auth, direct-insert flow)

## 1. Goal

Make the checker free but abuse-resistant: **every authenticated user gets 3
checks per rolling 14-day window**, and no bot — single account or account
farm — can turn the checker into a money pump.

### Non-goals
- No anonymous tier. Search is already auth-gated (Supabase Auth); `user =
  auth.uid()`. This spec does not add anonymous access.
- No paid tier. 3 / 14 days is a hard ceiling for every account. A future
  paid/unlimited tier is out of scope but the limit is data-driven so it can
  be raised per-account later without a schema change.
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

### 4.1 Per-user rolling quota — `enforce_check_quota()` trigger

A `BEFORE INSERT` trigger function on `investigations`, added in a new
migration. Runs after RLS `with check` passes and alongside the existing
`before insert` triggers (trigger fire order is alpha by name; quota only
*reads* a count, so order versus `force_investigation_defaults` is
immaterial).

Logic:
```
limit  := coalesce(current_setting('app.settings.check_quota_limit', true)::int, 3)
window := coalesce(current_setting('app.settings.check_quota_window_days', true)::int, 14)
used   := count(*) from investigations
          where user_id = auth.uid()
            and created_at > now() - (window || ' days')::interval
if used >= limit:
    resets_at := (min(created_at) of those rows) + window days
    RAISE LOG  'check_quota_denied user=% used=% limit=%', auth.uid(), used, limit
    RAISE sqlstate 'PT429'
      using message = 'check_quota_exceeded',
            hint    = to_char(resets_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
```

Design decisions:
- **Rolling 14-day window**, not a calendar reset. It needs no cron, ages
  out naturally, and cannot be gamed at a boundary (a fixed date lets a user
  burn 3 at 23:59 and 3 more at 00:01). The concrete reset moment shown to
  the user is `oldest-in-window + 14 days`.
- **Every submission counts**, regardless of terminal status. Every insert
  triggers the pipeline, so counting only successes would let crafted-to-fail
  inputs run free. Operators refund by deleting a row (service role bypasses
  RLS and this trigger).
- **Limit/window are `current_setting('app.settings.*')`** with defaults 3/14
  — same operator-config pattern the webhook trigger already uses in
  `20260819073420_investigations_v1.sql`. Bump the limit with `alter database
  … set app.settings.check_quota_limit = '…'`, no deploy.
- **`PT429`**: PostgREST maps a `PTxyz` SQLSTATE to HTTP status `xyz`, so the
  client receives **HTTP 429** with `{code:"PT429", message:"check_quota_
  exceeded", hint:<resets_at>}`. The client matches on `message`, so UX does
  not hard-depend on the status; the 429 is verified by test (§8).
- **Service role / worker inserts bypass** — the worker connects as the DB
  owner / service role, which bypasses RLS *and* triggers are still fired but
  `auth.uid()` is null for a service connection; the count for a null user is
  irrelevant because the worker never inserts into `investigations` (it only
  updates). No carve-out needed, but the trigger guards `if auth.uid() is
  null then return new` to be explicit and future-proof.

### 4.2 Quota status — `quota_status()` RPC + client UX

A `SECURITY DEFINER` SQL function, `grant execute … to authenticated`,
returning the caller's window state so the UI never has to reverse-engineer
it from a raw insert error:
```
quota_status() -> table(used int, "limit" int, resets_at timestamptz)
```
`used`/`limit` computed exactly as §4.1; `resets_at` is `min(created_at)+window`
over in-window rows (null when `used = 0`).

Web (`/verify`):
- On load, call `quota_status()`; render "**N of 3 checks left · resets
  <date>**".
- When `used >= limit`, **disable the submit button** and show the reset
  copy, so the wall is a UI state, not a raw DB error.
- Still handle the insert rejection defensively: HTTP 429 or `message ===
  'check_quota_exceeded'` → show the same reset message (covers the race where
  a second tab spends the last slot).

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
**omitted**: the 3 / 14-day quota (§4.1) is a far tighter cap on the expensive
path — even all 3 fired in one second is only 3 runs — so a velocity limit on
top adds nothing. Rate limiting is instead handled where the quota does *not*
meter:

- **Signup / login velocity** (the account-farm vector) → **Supabase Auth's
  built-in rate limits** (dashboard → Auth → Rate Limits), tuned down. Config,
  not code. This is the primary control on farm creation speed.
- **`quota_status()` and other reads** → cheap (one indexed count, no LLM
  spend); if needed, a coarse per-IP limit at the **edge/WAF**, not in-app.
- **Raw request / connection floods (L7)** → **edge/WAF** (e.g. Cloudflare).

No application-level rate limiter is built as part of this work.

## 5. Data model changes

All additive; one new migration file
`supabase/migrations/2026082110XXXX_check_quota_anti_abuse.sql` (+ a seed
migration for blocked domains):

- `investigations`: **no column change** — index `create index if not exists
  investigations_user_created_idx on investigations (user_id, created_at)` to
  keep the per-user window count and daily-spend scan cheap.
- `enforce_check_quota()` + `before insert` trigger on `investigations`.
- `quota_status()` + grant.
- `blocked_email_domains (domain text primary key)` + seed + `reject_
  disposable_email()` + `before insert` trigger on `auth.users`.
- Views `abuse_daily_spend`, `abuse_signups_hourly`; `abuse_snapshot()`.
- Operator settings: `app.settings.check_quota_limit` (default 3),
  `app.settings.check_quota_window_days` (default 14) — documented in
  `scripts/RUNBOOK.md`; trigger has code defaults so an unset env still works.

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
- DB: `alter database postgres set app.settings.check_quota_limit = '3'`;
  `… check_quota_window_days = '14'` (optional — defaults baked in).
- Supabase dashboard: Auth → "Confirm email" **ON**; enable Google OAuth.
- RUNBOOK: refreshing `blocked_email_domains`; reading `abuse_*` views.

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

## 9. Implementation phases (TDD; testing folded in; ≤6)

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

## 10. Risks & trade-offs

- **Account farming remains theoretically possible** — the signup gate raises
  cost (confirmed inbox per 3 checks) but does not eliminate it; the global
  ceiling is the hard financial stop. Accepted: matches "free tool" intent.
- **Rolling window ≠ a friendly fixed reset date.** Mitigated by surfacing a
  concrete `resets_at` (oldest-in-window + 14d).
- **Trigger cost on the hot insert path** — one indexed `count(*)` over a
  low-volume, quota-capped table. Negligible; the `(user_id, created_at)`
  index covers it.
- **A global-ceiling day burns a user's quota slot** (the insert counted, the
  run was refused). Rare backstop; operators refund by deleting the row.
- **`PT429`/`PT422` depend on PostgREST's `PTxyz` status mapping** — asserted
  by test so a PostgREST behavior change is caught, and the client also
  matches on `message` as a fallback.
