# Check Quota & Anti-Abuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every authenticated user 3 free checks per rolling 14-day window and cap total spend against account-farm abuse, enforced where the checker is actually entered.

**Architecture:** The V1 web client inserts `investigations` rows **directly into Supabase via PostgREST** under RLS (`with check (user_id = auth.uid())`); the worker picks them up. There is no app server in the insert path, so per-user quota and the signup gate live in the **database** (triggers/RPC), the global cost ceiling lives in the **worker** (the only component that knows a run's cost), and the web reads quota state to render it and disable submit.

**Tech Stack:** Postgres/Supabase migrations + PL/pgSQL; PostgREST error→HTTP mapping (`PTxyz`); Python 3.12 (FastAPI/worker, pydantic-settings, psycopg async, pytest); Next.js/React client (`@supabase/supabase-js`, react-hook-form, vitest + @testing-library/react).

**Spec:** `docs/superpowers/specs/2026-08-21-check-quota-anti-abuse-design.md` (read it alongside this plan).

## Global Constraints

- **Quota:** limit **3**, window **14 days**, rolling (not calendar reset). Every submission counts regardless of outcome.
- **Limit/window are operator-tunable** via `current_setting('app.settings.check_quota_limit' | 'check_quota_window_days', true)` with hard-coded fallbacks **3 / 14** — an unset setting must still work.
- **Enforcement location is fixed:** quota + signup gate in the DB; cost ceiling in the worker; never a client-side-only check.
- **Error contract:** over-quota → SQLSTATE `PT429`, `message = 'check_quota_exceeded'`, `hint = <resets_at ISO8601>`. Disposable email → SQLSTATE `PT422`, `message = 'email_domain_not_allowed'`. The web matches on **`error.code`** *and* falls back to **`error.message`**.
- **DB tests are static SQL-text assertions** in `apps/api/tests/migrations/` (read the `.sql`, assert lowercased substrings); live behavioral checks are appended to `scripts/verify_rls.sql` as numbered `Case N` blocks (operator-run, not CI).
- **Migrations are additive and immutable once applied.** Use the exact filenames given per task.
- Per house rule, **no commit steps** in this plan; commit at your own cadence.

---

## File map

- Create `supabase/migrations/20260821120000_check_quota.sql` — per-user quota trigger + index (Task 1).
- Create `supabase/migrations/20260821121000_quota_status_rpc.sql` — `quota_status()` RPC + grant (Task 2).
- Create `supabase/migrations/20260821122000_disposable_email_block.sql` — blocked-domain table + seed + `auth.users` trigger (Task 5).
- Create `supabase/migrations/20260821123000_abuse_observability.sql` — abuse views + `abuse_snapshot()` (Task 6).
- Modify `scripts/verify_rls.sql` — behavioral `Case 9` (quota) and `Case 10` (disposable email).
- Create `apps/api/tests/migrations/test_check_quota_anti_abuse.py` — text-assertion tests for all four migrations (Tasks 1, 2, 5, 6).
- Modify `apps/web/lib/investigations.ts` — `quotaStatus()` + quota-aware `createInvestigation` (Task 3).
- Modify `apps/web/components/verify/NewCheckForm.tsx` — render remaining/reset, disable at limit, map quota error (Task 4).
- Modify `apps/web/components/verify/__tests__/NewCheckForm.test.tsx` — quota UI tests (Task 4).
- Modify `apps/api/src/app/config.py` — `global_daily_usd_ceiling` (Task 7).
- Modify `apps/api/src/app/worker/persistence.py` — `day_spend_usd()`, `mark_capacity_blocked()` (Task 7).
- Modify `apps/api/src/app/worker/functions.py` — global-ceiling short-circuit (Task 7).
- Modify `apps/api/tests/worker/test_functions.py` — extend `FakePersistence`, add ceiling tests (Task 7).
- Modify `apps/api/tests/test_config.py` — ceiling default (Task 7).

---

## Phase 1 — Per-user rolling quota (DB)

### Task 1: `enforce_check_quota()` trigger + index

**Files:**
- Create: `supabase/migrations/20260821120000_check_quota.sql`
- Modify: `scripts/verify_rls.sql` (append `Case 9`)
- Test: `apps/api/tests/migrations/test_check_quota_anti_abuse.py`

**Interfaces:**
- Produces: a `before insert` trigger `trg_enforce_check_quota` on `investigations` that raises `PT429`/`check_quota_exceeded` (hint=resets_at) when the caller has ≥ limit rows in the window; index `investigations_user_created_idx`. Consumed by Task 2 (`quota_status()` mirrors its count) and Task 3 (web maps the error).

- [ ] **Step 1: Write the failing text-assertion test**

Create `apps/api/tests/migrations/test_check_quota_anti_abuse.py`:

```python
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def _sql(name: str) -> str:
    p = MIGRATIONS / name
    return p.read_text().lower() if p.exists() else ""


QUOTA = _sql("20260821120000_check_quota.sql")


def test_quota_index_created():
    assert "investigations_user_created_idx" in QUOTA
    assert "on investigations (user_id, created_at)" in QUOTA


def test_quota_trigger_reads_operator_settings_with_defaults():
    assert "app.settings.check_quota_limit" in QUOTA
    assert "app.settings.check_quota_window_days" in QUOTA
    assert ", 3)" in QUOTA          # limit fallback
    assert ", 14)" in QUOTA         # window fallback


def test_quota_trigger_guards_null_uid():
    assert "auth.uid() is null" in QUOTA


def test_quota_trigger_raises_pt429_with_message_and_hint():
    assert "pt429" in QUOTA
    assert "check_quota_exceeded" in QUOTA
    assert "hint" in QUOTA


def test_quota_trigger_logs_denials():
    assert "raise log" in QUOTA


def test_quota_trigger_is_before_insert_on_investigations():
    assert "trg_enforce_check_quota before insert on investigations" in QUOTA


def test_verify_rls_has_quota_case():
    assert "case 9" in VERIFY
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -q`
Expected: FAIL (migration file does not exist → all assertions fail on empty string).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821120000_check_quota.sql`:

```sql
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
```

- [ ] **Step 4: Append the behavioral `Case 9` to `scripts/verify_rls.sql`**

Append at end of `scripts/verify_rls.sql` (operator-run; service role bypasses RLS for seeding, so it seeds under a real user id and sets the JWT claim so `auth.uid()` resolves):

```sql
-- Case 9: per-user rolling quota (spec §4.1). Seeds 3 rows for user A in-window,
-- asserts the 4th is rejected (PT429), user B is unaffected, and a >14-day-old
-- row does not count.
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
```

- [ ] **Step 5: Run the text-assertion tests and confirm they pass**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -q`
Expected: PASS (7 tests).

- [ ] **Step 6: Confirm the migration applies and behaves (local Supabase)**

Run: `supabase db reset` then `supabase db execute --file scripts/verify_rls.sql` (or `psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql`).
Expected: applies cleanly; prints `Case 9 PASS`, no `Case 9 FAIL`.

---

## Phase 2 — Quota status: RPC + client UX

### Task 2: `quota_status()` RPC + grant

**Files:**
- Create: `supabase/migrations/20260821121000_quota_status_rpc.sql`
- Test: `apps/api/tests/migrations/test_check_quota_anti_abuse.py` (add functions)

**Interfaces:**
- Produces: `quota_status()` → `table(used int, "limit" int, resets_at timestamptz)`, `security definer`, executable by `authenticated`. Consumed by Task 3 (`quotaStatus()`).

- [ ] **Step 1: Write the failing text-assertion test**

Append to `apps/api/tests/migrations/test_check_quota_anti_abuse.py`:

```python
RPC = _sql("20260821121000_quota_status_rpc.sql")


def test_quota_status_function_shape():
    assert "create or replace function quota_status()" in RPC
    assert "returns table(used int" in RPC
    assert "resets_at timestamptz" in RPC


def test_quota_status_is_security_definer():
    assert "security definer" in RPC


def test_quota_status_granted_to_authenticated_only():
    assert "revoke all on function quota_status() from public" in RPC
    assert "grant execute on function quota_status() to authenticated" in RPC
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -k quota_status -q`
Expected: FAIL (file missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821121000_quota_status_rpc.sql`:

```sql
-- Read-side of the quota (spec §4.2): the client's current window state so the
-- UI renders "N of 3 left · resets <date>" and disables submit, instead of
-- reverse-engineering it from a raw insert error. Mirrors enforce_check_quota()
-- exactly (same settings + fallbacks). security definer so the count is over
-- the caller's own rows via auth.uid().
create or replace function quota_status()
returns table(used int, "limit" int, resets_at timestamptz)
language sql security definer stable
set search_path = public
as $$
  select
    count(*)::int,
    coalesce(nullif(current_setting('app.settings.check_quota_limit', true), '')::int, 3),
    case when count(*) = 0 then null
         else min(created_at)
              + (coalesce(nullif(current_setting('app.settings.check_quota_window_days', true), '')::int, 14)
                 || ' days')::interval
    end
  from investigations
  where user_id = auth.uid()
    and created_at > now()
        - (coalesce(nullif(current_setting('app.settings.check_quota_window_days', true), '')::int, 14)
           || ' days')::interval;
$$;

revoke all on function quota_status() from public;
grant execute on function quota_status() to authenticated;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -q`
Expected: PASS (10 tests total).

### Task 3: `quotaStatus()` + quota-aware `createInvestigation`

**Files:**
- Modify: `apps/web/lib/investigations.ts`
- Test: covered by Task 4's component tests (this task is exercised through the form)

**Interfaces:**
- Consumes: `quota_status()` RPC (Task 2); the PostgREST error object (`{code, message, hint}`) from Task 1.
- Produces:
  - `type QuotaStatus = { used: number; limit: number; resetsAt: string | null }`
  - `quotaStatus(client): Promise<QuotaStatus>`
  - `type CreateResult = { id: string } | { error: string; quotaExceeded?: boolean; resetsAt?: string | null }`
  - `createInvestigation(client, submission): Promise<CreateResult>` (quota-aware). Consumed by Task 4.

- [ ] **Step 1: Add `QuotaStatus` + `quotaStatus()` to `apps/web/lib/investigations.ts`**

Add after the `Client` type alias:

```ts
export type QuotaStatus = { used: number; limit: number; resetsAt: string | null };

export async function quotaStatus(client: Client): Promise<QuotaStatus> {
  // `quota_status` is a DB RPC not present in the hand-authored Database types;
  // cast narrowly (same pattern as the `as unknown as` casts elsewhere here).
  const { data } = await (client.rpc as unknown as (fn: string) => {
    single: () => Promise<{ data: { used?: number; limit?: number; resets_at?: string | null } | null }>;
  })("quota_status").single();
  const row = data ?? {};
  return { used: row.used ?? 0, limit: row.limit ?? 3, resetsAt: row.resets_at ?? null };
}
```

- [ ] **Step 2: Make `createInvestigation` quota-aware**

Replace the existing `createInvestigation` in `apps/web/lib/investigations.ts` with:

```ts
export type CreateResult =
  | { id: string }
  | { error: string; quotaExceeded?: boolean; resetsAt?: string | null };

export async function createInvestigation(
  client: Client,
  submission: SubmissionInput,
): Promise<CreateResult> {
  const { data, error } = await client
    .from("investigations")
    .insert({ submission })
    .select("id")
    .single();
  if (error || !data) {
    // Over-quota surfaces as SQLSTATE PT429 (HTTP 429). Match on code first,
    // fall back to the message so UX survives a PostgREST mapping change.
    if (error?.code === "PT429" || error?.message === "check_quota_exceeded") {
      return { error: "check_quota_exceeded", quotaExceeded: true, resetsAt: error?.hint ?? null };
    }
    return { error: error?.message ?? "Could not start the check." };
  }
  return { id: (data as { id: string }).id };
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new type errors. (Behavior is verified via Task 4.)

### Task 4: NewCheckForm — render quota, disable at limit, map the error

**Files:**
- Modify: `apps/web/components/verify/NewCheckForm.tsx`
- Test: `apps/web/components/verify/__tests__/NewCheckForm.test.tsx`

**Interfaces:**
- Consumes: `quotaStatus()`, `createInvestigation()`, `QuotaStatus`, `CreateResult` (Task 3).

- [ ] **Step 1: Write the failing component tests**

Add to the existing mock block in `apps/web/components/verify/__tests__/NewCheckForm.test.tsx` (extend the `lib/investigations` mock to also expose `quotaStatus`):

```ts
const createInvestigation = vi.fn();
const quotaStatus = vi.fn();
vi.mock("../../../lib/investigations", () => ({
  createInvestigation: (...a: any) => createInvestigation(...a),
  quotaStatus: (...a: any) => quotaStatus(...a),
}));
```

Then add these cases inside `describe("NewCheckForm", …)`:

```ts
it("shows remaining checks and the reset date", async () => {
  quotaStatus.mockResolvedValueOnce({ used: 1, limit: 3, resetsAt: "2026-09-04T00:00:00Z" });
  createInvestigation.mockResolvedValue({ id: "abc" });
  render(<NewCheckForm initialJobText="x" />);
  expect(await screen.findByText(/2 of 3 checks left/i)).toBeInTheDocument();
});

it("disables submit and blocks the call when the quota is exhausted", async () => {
  quotaStatus.mockResolvedValueOnce({ used: 3, limit: 3, resetsAt: "2026-09-04T00:00:00Z" });
  render(<NewCheckForm initialJobText="Acme VA role" />);
  await screen.findByText(/0 of 3 checks left/i);
  const button = screen.getByRole("button", { name: /run the check/i });
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(createInvestigation).not.toHaveBeenCalled();
});

it("maps a quota rejection on submit to the reset message", async () => {
  quotaStatus.mockResolvedValueOnce({ used: 2, limit: 3, resetsAt: null });
  createInvestigation.mockResolvedValueOnce({
    error: "check_quota_exceeded", quotaExceeded: true, resetsAt: "2026-09-04T00:00:00Z",
  });
  render(<NewCheckForm initialJobText="Acme VA role" />);
  await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
  expect(await screen.findByText(/used all 3 checks/i)).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/web && npx vitest run components/verify/__tests__/NewCheckForm.test.tsx`
Expected: FAIL (no quota text; `quotaStatus` unused; button not disabled).

- [ ] **Step 3: Implement the quota UI in `NewCheckForm.tsx`**

Add the import and a helper near the top of the file:

```tsx
import { createInvestigation, quotaStatus, type QuotaStatus } from "../../lib/investigations";

function resetCopy(resetsAt: string | null): string {
  if (!resetsAt) return "You’ve used all 3 checks. Your quota resets soon.";
  const d = new Date(resetsAt);
  return `You’ve used all 3 checks. Your quota resets on ${d.toLocaleDateString()}.`;
}
```

Inside the component, add quota state + load it on mount:

```tsx
const [quota, setQuota] = useState<QuotaStatus | null>(null);
useEffect(() => {
  let active = true;
  quotaStatus(createClient())
    .then((q) => { if (active) setQuota(q); })
    .catch(() => { /* non-blocking: the DB trigger is the real gate */ });
  return () => { active = false; };
}, []);
const remaining = quota ? Math.max(quota.limit - quota.used, 0) : null;
const exhausted = remaining === 0;
```

Guard the submit and map the quota error in `onSubmit`:

```tsx
async function onSubmit(values: SubmissionInput) {
  setFormError(null);
  if (exhausted) { setFormError(resetCopy(quota?.resetsAt ?? null)); return; }
  const result = await createInvestigation(createClient(), values);
  if ("error" in result) {
    setFormError(
      result.quotaExceeded ? resetCopy(result.resetsAt ?? null)
                           : "We couldn’t start the check. " + result.error,
    );
    return;
  }
  flow?.reset();
  router.push(`/investigations/${result.id}`);
}
```

Render the counter above the submit row, and disable the button when exhausted. Add this just before the `<div className="flex flex-wrap gap-3">` submit block:

```tsx
{quota ? (
  <p className="text-[13px] leading-[1.5] text-ink-soft">
    {remaining} of {quota.limit} checks left
    {quota.resetsAt ? ` · resets ${new Date(quota.resetsAt).toLocaleDateString()}` : ""}
  </p>
) : null}
```

and change the `Button` to include `disabled={exhausted}`:

```tsx
<Button
  variant="primary"
  size="wide"
  type="submit"
  className="flex-1"
  disabled={exhausted}
  pending={isSubmitting}
  pendingLabel="RUNNING THE CHECK…"
>
  RUN THE CHECK
</Button>
```

> If `Button` does not already forward a `disabled` prop, add `disabled` to its props and pass it to the underlying `<button>`; keep `pending` behavior unchanged.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd apps/web && npx vitest run components/verify/__tests__/NewCheckForm.test.tsx`
Expected: PASS (existing cases + 3 new). Then `npx tsc --noEmit` clean.

---

## Phase 3 — Global daily cost ceiling (worker)

### Task 7: Ceiling config + persistence + short-circuit

**Files:**
- Modify: `apps/api/src/app/config.py`
- Modify: `apps/api/src/app/worker/persistence.py`
- Modify: `apps/api/src/app/worker/functions.py`
- Test: `apps/api/tests/worker/test_functions.py`, `apps/api/tests/test_config.py`

**Interfaces:**
- Produces: `settings.global_daily_usd_ceiling: float` (default `25.00`); `Persistence.day_spend_usd() -> float`; `Persistence.mark_capacity_blocked(inv_id) -> None`. `handle_requested` returns `"failed"` when the day's spend ≥ ceiling, without running the graph.

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/worker/test_functions.py`, extend `FakePersistence` so the new call sites exist (default spend 0.0 keeps every existing test green):

```python
class FakePersistence:
    def __init__(self, submission, cached=None):
        self._sub = submission; self.status = None; self.result = None; self.backfilled = False
        self.day_spend = 0.0; self.capacity_blocked = False
    async def get_submission(self, inv): return self._sub, "queued"
    async def set_status(self, inv, s): self.status = s
    async def persist_result(self, inv, **kw): self.result = kw
    async def backfill(self, inv): self.backfilled = True
    async def day_spend_usd(self): return self.day_spend
    async def mark_capacity_blocked(self, inv): self.capacity_blocked = True
```

Add two cases:

```python
async def test_global_ceiling_blocks_and_skips_graph(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    p.day_spend = 999.0
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    monkeypatch.setattr(functions.settings, "global_daily_usd_ceiling", 25.0)
    ran = False
    async def run(inv, sub, sink):
        nonlocal ran; ran = True; return InvestigationState(submission=sub), "done"
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "failed" and p.capacity_blocked is True and ran is False


async def test_under_ceiling_runs_normally(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    p.day_spend = 1.0
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)
    monkeypatch.setattr(functions.settings, "global_daily_usd_ceiling", 25.0)
    async def run(inv, sub, sink): return InvestigationState(submission=sub), "done"
    status = await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert status == "done" and p.capacity_blocked is False and p.result is not None
```

In `apps/api/tests/test_config.py` add:

```python
def test_global_daily_ceiling_default():
    from app.config import Settings
    assert Settings().global_daily_usd_ceiling == 25.00
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && uv run pytest tests/worker/test_functions.py -k "ceiling or normally" tests/test_config.py::test_global_daily_ceiling_default -q`
Expected: FAIL (`settings` has no `global_daily_usd_ceiling`; `functions` doesn't import `settings`; no short-circuit).

- [ ] **Step 3: Add the config setting**

In `apps/api/src/app/config.py`, add after `zombie_running_threshold_s`:

```python
    # Global emergency brake (spec §4.3): once the day's summed spend across all
    # investigations reaches this, new runs are refused (terminal 'failed' +
    # capacity marker) instead of running. Backstop against account-farm abuse
    # that slips the per-user quota. USD.
    global_daily_usd_ceiling: float = 25.00
```

- [ ] **Step 4: Add the persistence methods**

In `apps/api/src/app/worker/persistence.py`, add two methods to `Persistence`:

```python
    async def day_spend_usd(self) -> float:
        pool = await db.get_pool()
        async with pool.connection() as c:
            cur = await c.execute(
                "SELECT COALESCE(SUM((cost->>'total_usd')::numeric), 0) AS s "
                "FROM investigations "
                "WHERE created_at >= date_trunc('day', now() at time zone 'utc')")
            row = await cur.fetchone()
        return float(row["s"])

    async def mark_capacity_blocked(self, inv_id) -> None:
        # Terminal 'failed' + a cost marker the client can detect to show
        # capacity-specific copy (spec §4.3). No graph ran, so no results.
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute(
                "UPDATE investigations SET status='failed', "
                "cost='{\"total_usd\":0,\"by_node\":{},\"capacity_blocked\":true}'::jsonb "
                "WHERE id=%s", (inv_id,))
```

- [ ] **Step 5: Add the short-circuit in `handle_requested`**

In `apps/api/src/app/worker/functions.py`, add the import:

```python
from app.config import settings
```

Then, in `handle_requested`, insert the ceiling check **after** the cache-hit block returns and **before** `await persistence.set_status(inv_id, "running")`:

```python
    if await persistence.day_spend_usd() >= settings.global_daily_usd_ceiling:
        logger.warning("global daily ceiling reached; refusing investigation %s", inv_id)
        await persistence.mark_capacity_blocked(inv_id)
        return "failed"

    await persistence.set_status(inv_id, "running")
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd apps/api && uv run pytest tests/worker/test_functions.py tests/test_config.py::test_global_daily_ceiling_default -q`
Expected: PASS (existing worker tests still green because `day_spend` defaults to 0.0).

---

## Phase 4 — Signup gate: disposable-email block

### Task 5: `blocked_email_domains` + `auth.users` trigger

**Files:**
- Create: `supabase/migrations/20260821122000_disposable_email_block.sql`
- Modify: `scripts/verify_rls.sql` (append `Case 10`)
- Test: `apps/api/tests/migrations/test_check_quota_anti_abuse.py` (add functions)

**Interfaces:**
- Produces: table `blocked_email_domains(domain text primary key)` (seeded), `reject_disposable_email()` trigger on `auth.users` raising `PT422`/`email_domain_not_allowed`.

- [ ] **Step 1: Write the failing text-assertion test**

Append to `apps/api/tests/migrations/test_check_quota_anti_abuse.py`:

```python
BLOCK = _sql("20260821122000_disposable_email_block.sql")


def test_blocked_domains_table_and_seed():
    assert "create table if not exists blocked_email_domains" in BLOCK
    assert "domain text primary key" in BLOCK
    assert "mailinator.com" in BLOCK  # representative seed entry


def test_reject_disposable_email_raises_pt422():
    assert "create or replace function reject_disposable_email()" in BLOCK
    assert "pt422" in BLOCK
    assert "email_domain_not_allowed" in BLOCK


def test_reject_trigger_on_auth_users():
    assert "before insert on auth.users" in BLOCK


def test_verify_rls_has_disposable_case():
    assert "case 10" in VERIFY
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -k "disposable or blocked or reject or pt422" -q`
Expected: FAIL (file missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821122000_disposable_email_block.sql`:

```sql
-- Signup gate (spec §4.4): reject sign-ups from known disposable-email domains
-- so an account farm can't cheaply mint verified accounts to harvest 3 checks
-- each. Trigger on auth.users (the standard Supabase auth-schema trigger
-- pattern). Refresh the seed list periodically (see RUNBOOK).
create table if not exists blocked_email_domains (domain text primary key);

insert into blocked_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('10minutemail.com'),
  ('tempmail.com'), ('trashmail.com'), ('yopmail.com'), ('getnada.com'),
  ('dispostable.com'), ('maildrop.cc'), ('sharklasers.com')
on conflict do nothing;

create or replace function reject_disposable_email()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from blocked_email_domains
    where domain = lower(split_part(new.email, '@', 2))
  ) then
    raise sqlstate 'PT422' using message = 'email_domain_not_allowed';
  end if;
  return new;
end $$;

create trigger trg_reject_disposable_email before insert on auth.users
  for each row execute function reject_disposable_email();
```

- [ ] **Step 4: Append behavioral `Case 10` to `scripts/verify_rls.sql`**

```sql
-- Case 10: disposable-email signup block (spec §4.4). A blocked-domain insert
-- into auth.users is rejected (PT422) even under the service/owner role, because
-- a BEFORE INSERT trigger fires regardless of RLS/role.
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
```

- [ ] **Step 5: Run the text-assertion tests and confirm they pass**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -q`
Expected: PASS.

- [ ] **Step 6: Document operator prerequisites**

In `scripts/RUNBOOK.md`, add a short section: enable Supabase Auth **"Confirm email" ON** (unconfirmed users never receive a session, so they can never insert an investigation) and **Google OAuth** as the higher-trust path; and how to refresh `blocked_email_domains`.

- [ ] **Step 7: Confirm applies (local Supabase)**

Run: `supabase db reset` then re-run `scripts/verify_rls.sql`.
Expected: `Case 10 PASS`.

---

## Phase 5 — Abuse observability

### Task 6: Abuse views + `abuse_snapshot()`

**Files:**
- Create: `supabase/migrations/20260821123000_abuse_observability.sql`
- Test: `apps/api/tests/migrations/test_check_quota_anti_abuse.py` (add functions)

**Interfaces:**
- Produces: views `abuse_daily_spend`, `abuse_signups_hourly`; function `abuse_snapshot() -> table(today_usd numeric, signups_24h bigint)`. Relies on the `raise log` denial line already emitted by Task 1's trigger.

- [ ] **Step 1: Write the failing text-assertion test**

Append to `apps/api/tests/migrations/test_check_quota_anti_abuse.py`:

```python
OBS = _sql("20260821123000_abuse_observability.sql")


def test_abuse_views_created():
    assert "create or replace view abuse_daily_spend" in OBS
    assert "create or replace view abuse_signups_hourly" in OBS


def test_abuse_snapshot_function():
    assert "create or replace function abuse_snapshot()" in OBS
    assert "today_usd" in OBS
    assert "signups_24h" in OBS


def test_quota_trigger_denial_log_is_the_observability_signal():
    # The denial signal is the RAISE LOG in the Phase 1 quota trigger (a RAISE
    # LOG survives the transaction rollback the accompanying RAISE EXCEPTION
    # causes), so denials are observable in Postgres logs.
    assert "raise log" in QUOTA
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -k "abuse" -q`
Expected: FAIL (file missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260821123000_abuse_observability.sql`:

```sql
-- Operator-facing abuse observability (spec §4.5). No new service: two views +
-- a snapshot function. Quota denials are observable via the RAISE LOG line in
-- enforce_check_quota() (Postgres logs).
create or replace view abuse_daily_spend as
  select date_trunc('day', created_at) as day,
         count(*) as investigation_count,
         coalesce(sum((cost->>'total_usd')::numeric), 0) as total_usd
  from investigations
  group by 1
  order by 1 desc;

create or replace view abuse_signups_hourly as
  select date_trunc('hour', created_at) as hour, count(*) as signups
  from auth.users
  group by 1
  order by 1 desc;

create or replace function abuse_snapshot()
returns table(today_usd numeric, signups_24h bigint)
language sql security definer stable
set search_path = public
as $$
  select
    (select coalesce(sum((cost->>'total_usd')::numeric), 0)
       from investigations
      where created_at >= date_trunc('day', now() at time zone 'utc')),
    (select count(*) from auth.users where created_at > now() - interval '24 hours');
$$;

-- Operator/monitoring reads only; never the anon or authenticated client roles.
grant select on abuse_daily_spend, abuse_signups_hourly to service_role;
revoke all on function abuse_snapshot() from public;
grant execute on function abuse_snapshot() to service_role;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd apps/api && uv run pytest tests/migrations/test_check_quota_anti_abuse.py -q`
Expected: PASS (all text-assertion tests across Tasks 1, 2, 5, 6).

- [ ] **Step 5: Full-suite regression + apply**

Run: `cd apps/api && uv run pytest -q` (worker + config + migrations green; the two pre-existing `test_config` reasoning-effort failures are unrelated to this work). Then `supabase db reset` to confirm all four migrations apply cleanly in sequence.

---

## Self-review notes

- **Spec coverage:** §4.1→Task 1; §4.2→Tasks 2–4; §4.3→Task 7; §4.4→Task 5 (+ Step 6 confirm-email/OAuth docs); §4.5→Task 6; §4.6 (rate limiting) is config/no-code, no task; §6 error contract→Tasks 1, 3, 5; §7 config→Tasks 5(docs), 7.
- **External assumption:** PostgREST maps SQLSTATE `PTxyz`→HTTP `xyz`. The web matches `error.code` **and** `error.message`, so the UX holds even if that mapping changes; the DB tests pin the raised SQLSTATE. Verify the 429 end-to-end during Task 1 Step 6 against the pinned PostgREST version.
- **Type names are consistent** across tasks: `QuotaStatus`, `CreateResult`, `quotaStatus`, `createInvestigation`, `day_spend_usd`, `mark_capacity_blocked`, `global_daily_usd_ceiling`, `enforce_check_quota`, `quota_status`, `reject_disposable_email`.
