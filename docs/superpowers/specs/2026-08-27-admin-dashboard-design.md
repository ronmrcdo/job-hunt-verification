# Admin Dashboard Design

**Goal:** Give the operator a single read-only `/admin` landing page that answers "how is this thing doing?" at a glance — how many people have signed up, how many checks have run, how much feedback has come in (and of what kind), and where the feedback→dataset pipeline stands. Today `/admin` has no index at all: the only route is `/admin/feedback`, reachable only if you already know the URL. This spec adds the dashboard as the `/admin` index and leaves `/admin/feedback` untouched.

**Roadmap position:** A small operability follow-on to the feedback→eval loop (`docs/superpowers/specs/2026-08-26-feedback-eval-loop-design.md`). It surfaces, as headline numbers, the tables that loop already created (`feedback`, `eval_candidate`) plus the existing `investigations` table and the auth user count. It adds no new product surface and weakens no guardrail.

**Architecture:** The dashboard is a server component that reads counts through the **same server-only privileged client** the feedback triage page uses (`supabaseAdmin`, backed by the least-privilege `admin_ro` role). Every metric but one is a direct read of a table `admin_ro` is already granted: `investigations`, `feedback`, `eval_candidate`. The single exception is the registered-user count, which lives in `auth.users` — a schema `admin_ro` cannot read. Rather than grant the role broad access to user rows, we add one scoped `SECURITY DEFINER` function that returns **only** `count(*)` as an integer, and grant `execute` on it to `admin_ro`. So the dashboard exposes a single number from the auth schema and never a user row.

Two properties define the design:

1. **Read-only.** The page performs no writes and offers no actions. It is a viewport onto counts, nothing more. This keeps it trivially safe: no triage, no promotion, no mutation path is introduced.
2. **Least-privilege preserved.** `admin_ro` keeps exactly its current table grants. The one new capability is `execute` on a function whose entire output is a scalar count — the tightest possible way to surface a number the role otherwise couldn't see.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / vitest (apps/web), Postgres + Supabase migration (`SECURITY DEFINER` function), Python 3.12 / pytest (apps/api migration text-assertion test), Cloudflare Access (admin edge auth, unchanged from the feedback-loop spec).

**Spec references:** `docs/superpowers/specs/2026-08-26-feedback-eval-loop-design.md` (the `admin_ro` role, the server-only `supabaseAdmin` client, the CF Access edge guard, and the 404-not-403 convention this page reuses verbatim). Prior art for the page shape: `apps/web/app/admin/feedback/page.tsx` (server component, `assertAdmin`, `toTriageRows` pure shaper). Prior art for the migration test: `apps/api/tests/migrations/`.

## Global Constraints

- **Read-only, no new mutation.** The dashboard issues `SELECT`/`rpc` reads only. No `INSERT`/`UPDATE`/`DELETE` path, no server action, no form. `/admin/feedback` and its promote action are unchanged.
- **Least-privilege is not weakened.** `admin_ro` keeps its existing grants (`SELECT` on `investigations`, `feedback`; `INSERT` on `eval_candidate`). The only addition is `execute` on `public.admin_registered_user_count()`. The role is **not** granted `SELECT` on `auth.users`, and no user row ever leaves the database — only an aggregate integer.
- **The `SECURITY DEFINER` function is hardened like the loop's triggers.** It is declared `security definer`, `stable`, with `set search_path = ''` (fully-qualified `auth.users` inside), and `execute` is `revoke`d from `public` before being granted to `admin_ro`. This mirrors the server-force triggers in the feedback migration.
- **Edge auth and no-leak convention are reused, not re-invented.** `/admin` (the index) validates admin identity through the same `assertAdmin(headers)` the feedback page uses; an unauthorized request returns **404, not 403**. The dashboard adds no new auth logic.
- **All-time totals only.** Every figure is a lifetime count. No time-windowing (no "last 7 days") in this version — deliberately scoped out to keep each query a single unfiltered count.
- **The service_role key never reaches the browser.** Unchanged from the feedback-loop spec: all `/admin/*` data access is server-only; `supabaseAdmin` is imported only from server components; its key comes from a non-`NEXT_PUBLIC_` env var.
- **Migrations are operator-applied; their tests are text assertions**, not executed SQL — follow `apps/api/tests/migrations/`.
- Test commands: web `cd apps/web && pnpm vitest run <path>`; API migration test `cd apps/api && uv run pytest <path> -v`.
- Per project convention, the commit step is omitted from this spec.

## Metrics

All figures are lifetime totals, read through `admin_ro`.

| Metric | Source | Read |
| --- | --- | --- |
| **Registered users** | `auth.users` | `rpc('admin_registered_user_count')` → integer |
| **Investigations** | `public.investigations` | `select` with `head: true`, `count: 'exact'` |
| **Feedback — total + by verdict** | `public.feedback` | `select('verdict')`, tally in shaper |
| **Eval candidates — total + by status** | `public.eval_candidate` | `select('status')`, tally in shaper |

Enum values the shaper groups by:

- `feedback.verdict` ∈ `agree`, `too_high`, `too_low`
- `eval_candidate.status` ∈ `promoted`, `exported`

**Query note:** the two grouped metrics fetch just their one enum column and tally in the pure shaper, which keeps the grouping logic unit-testable without a database. This is fine at current data volume. If `feedback` grows large enough that fetching one column per row is wasteful, switch those two to per-group `head: true` counts. That is a **documented future tradeoff, not built now** (YAGNI).

## Data Flow

```
GET /admin  (operator, behind CF Access)
  └─ assertAdmin(headers)                         → AdminAccessError ⇒ notFound() (404)
  └─ reads via supabaseAdmin (admin_ro):
       • investigations  count (head:true)        → number
       • feedback        select('verdict')        → string[]
       • eval_candidate  select('status')         → string[]
       • rpc('admin_registered_user_count')       → number
  └─ toDashboardStats(raw)                         → view model
  └─ render stat cards (read-only)
```

## Components

### 1. Migration — `supabase/migrations/<ts>_admin_dashboard.sql`

Adds one scoped counter. Shape (final SQL settled in implementation):

```sql
create or replace function public.admin_registered_user_count()
returns integer
language sql
security definer
stable
set search_path = ''
as $$ select count(*)::integer from auth.users $$;

revoke execute on function public.admin_registered_user_count() from public;
grant execute on function public.admin_registered_user_count() to admin_ro;
```

Rationale: `admin_ro` cannot read `auth.users` and we do not want it to. A `SECURITY DEFINER` function runs with the definer's rights and returns only the scalar, so the role gains the count without gaining row access. `search_path = ''` + fully-qualified `auth.users` prevents search-path hijacking, exactly as the feedback migration's triggers do.

### 2. Pure shaper — `toDashboardStats(raw)`

A top-level export (mirroring `toTriageRows` in the feedback page), so grouping is tested without rendering the server component.

- **Input:** `{ registeredUsers: number; investigationsTotal: number; feedbackVerdicts: string[]; candidateStatuses: string[] }`
- **Output:** a view model with the four headline totals plus grouped tallies:
  - `feedback: { total, agree, too_high, too_low }`
  - `candidates: { total, promoted, exported }`
  - `registeredUsers`, `investigationsTotal`
- Unknown/unexpected enum strings are ignored (defensive), so a future enum value cannot crash the page.

### 3. Page — `apps/web/app/admin/page.tsx`

Server component:

1. `await assertAdmin(await headers())`; catch `AdminAccessError → notFound()` (404, never 403), identical to `/admin/feedback/page.tsx`.
2. Run the four reads via `supabaseAdmin`.
3. `toDashboardStats(raw)`.
4. Render a card grid.

**UI:** a simple responsive card grid using the existing tokens (`border-rule-soft`, `text-muted`, mono numerals), visually consistent with the feedback page. Cards: **Registered users**, **Investigations**, **Feedback** (total + the three verdict sub-counts), **Eval candidates** (total + promoted/exported). Read-only; no links required beyond what already exists, though a small link to `/admin/feedback` is acceptable for navigation.

## Error Handling

- **Auth failure** → `notFound()` (404). No existence leak.
- **A failed or null query** coalesces to `0` for that metric (Supabase returns `{ data: null }` on error; the shaper treats null/absent as empty). One broken read shows a `0` card; it never throws and never blanks the whole page.
- **RPC absent** (migration not yet applied) surfaces as a `0`/`—` registered-users card, not a crash. The rest of the dashboard still renders.

## Testing

- **`apps/web/app/admin/__tests__/page.test.ts`** — mock `supabaseAdmin` via the established `vi.mock('.../lib/supabase/admin', () => ({ supabaseAdmin: {} }))` pattern (the module constructs a client at load and must be stubbed under vitest). Cover:
  - `toDashboardStats` groups verdicts and statuses correctly, including an unknown enum value being ignored and empty arrays → all-zero tallies.
  - The page renders each headline number and the verdict/status sub-counts.
  - Non-admin request path (assertAdmin throwing `AdminAccessError`) triggers `notFound()`.
- **`apps/api/tests/migrations/test_admin_dashboard.py`** — text-assertion test over the migration file (mirroring `apps/api/tests/migrations/`): the function is declared `security definer`, `stable`, `set search_path = ''`; `execute` is revoked from `public` and granted to `admin_ro`; and the migration does **not** grant `admin_ro` any `select` on `auth.users` (a positive least-privilege assertion).

## Out of Scope

- Dataset composition (band/tag distribution from `eval/dataset.json`) — would need an `apps/api` read endpoint; not requested.
- Eval run history / scores over time — no run-result store exists yet; a separate feature.
- Time-windowed metrics ("last 7 days"), charts, trends.
- Any change to `/admin/feedback` or the promote flow.
