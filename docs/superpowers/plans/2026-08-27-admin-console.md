# Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/admin` into one operator console — an at-a-glance Overview stat grid stacked above the existing feedback-triage queue — and fold the old `/admin/feedback` route into it.

**Architecture:** A single server-component page loads four all-time counts and the triage queue concurrently through the existing server-only `supabaseAdmin` (role `admin_ro`), shapes them with pure functions, and renders `<OverviewGrid>` + the relocated `<FeedbackTriage>`. A new hardened `SECURITY DEFINER` function surfaces the `auth.users` count; a one-line grant gives `admin_ro` SELECT on `eval_candidate`. The triage UI, its `promote` server action, and its pure core move from `app/admin/feedback/` up into `app/admin/`, and `/admin/feedback` becomes a 308 redirect to `/admin`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / vitest + @testing-library/react (apps/web, jsdom); Postgres + Supabase migration (`SECURITY DEFINER`); Python 3.12 / pytest (apps/api migration text-assertion test).

**Spec:** `docs/superpowers/specs/2026-08-27-admin-dashboard-design.md`

## Global Constraints

- **One page, no *new* mutation.** Overview is `SELECT`/`rpc` reads only. The single write path is the **existing** `promote` action, relocated to `app/admin/actions.ts` unchanged in behavior (one `eval_candidate` INSERT). No additional INSERT/UPDATE/DELETE.
- **Least-privilege, minimally widened, read-only.** `admin_ro` gains exactly `execute` on `public.admin_registered_user_count()` and `SELECT` on `public.eval_candidate`. Still **no** `SELECT` on `auth.users`; no delete/update; no other new table.
- **`SECURITY DEFINER` hardening:** `security definer`, `stable`, `set search_path = ''`, fully-qualified `auth.users`, `execute` revoked from `public` before granting to `admin_ro`.
- **Edge auth reused, 404 not 403.** `/admin` calls `assertAdmin(await headers())`; `AdminAccessError → notFound()`. No new auth logic.
- **All-time totals only** (no time-windowing). **service_role never reaches the browser** (`supabaseAdmin` is `server-only`, key is non-`NEXT_PUBLIC_`).
- **Migrations are operator-applied; their tests are text assertions** over the SQL file, not executed SQL.
- Design tokens in `apps/web/app/globals.css` (`@theme`) are authoritative: `border-radius:0`, hairline rules, **no shadows** on stat cards, `font-mono` + `tabular-nums` numerals, one accent family. Tests assert **text/roles**, never Tailwind class names.
- Test commands: web `cd apps/web && pnpm vitest run <path>`; API `cd apps/api && uv run pytest <path> -v`.
- Per project convention, commit steps are omitted from this plan.

---

## File Structure

- `supabase/migrations/20260827000000_admin_dashboard.sql` — **new**: counter function + `eval_candidate` SELECT grant.
- `apps/api/tests/migrations/test_admin_dashboard.py` — **new**: text assertions over that SQL.
- `apps/web/app/admin/stats.ts` — **new**: `toDashboardStats` pure shaper + `DashboardStats` type.
- `apps/web/app/admin/triage.tsx` — **new** (moved from `feedback/page.tsx`): `loadTriage`, `toTriageRows`, `TriageRow`, `TriageResult`, and the extracted `FeedbackTriage` presentational component.
- `apps/web/app/admin/actions.ts` — **new** (moved from `feedback/actions.ts`): `promote`, revalidating `/admin`.
- `apps/web/app/admin/promote-core.ts` — **new** (moved from `feedback/promote-core.ts`): `buildCandidate`, `PromoteError`, `Band`.
- `apps/web/app/admin/PromoteButton.tsx` — **new**: `"use client"` submit button with `useFormStatus` pending state.
- `apps/web/app/admin/OverviewGrid.tsx` — **new**: prop-driven `<dl>` stat grid.
- `apps/web/app/admin/AdminHeader.tsx` — **new**: minimal server-component top bar.
- `apps/web/app/admin/layout.tsx` — **new**: renders `AdminHeader` above `{children}`.
- `apps/web/app/admin/page.tsx` — **new**: the console (`loadConsole` loader + default page).
- `apps/web/app/admin/feedback/page.tsx` — **replaced**: 308 redirect to `/admin`.
- Deleted: `app/admin/feedback/actions.ts`, `app/admin/feedback/promote-core.ts`, `app/admin/feedback/__tests__/page.test.ts`, `app/admin/feedback/__tests__/actions.test.ts`.
- Tests: `app/admin/__tests__/{stats,triage,actions,overview-grid,admin-header,page}.test.ts(x)`, `app/admin/feedback/__tests__/redirect.test.ts`.

---

## Task 1: Migration — registered-user counter + eval_candidate grant

**Files:**
- Create: `supabase/migrations/20260827000000_admin_dashboard.sql`
- Test: `apps/api/tests/migrations/test_admin_dashboard.py`

**Interfaces:**
- Produces: SQL function `public.admin_registered_user_count() → integer`; grants `execute` to `admin_ro` and `select on public.eval_candidate` to `admin_ro`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/migrations/test_admin_dashboard.py
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
SQL = (MIGRATIONS / "20260827000000_admin_dashboard.sql").read_text().lower()


def test_counter_is_security_definer_stable_empty_search_path():
    assert "create or replace function public.admin_registered_user_count()" in SQL
    assert "security definer" in SQL
    assert "stable" in SQL
    assert "set search_path = ''" in SQL
    assert "from auth.users" in SQL  # fully-qualified under empty search_path


def test_execute_revoked_from_public_then_granted_to_admin_ro():
    assert "revoke execute on function public.admin_registered_user_count() from public" in SQL
    assert "grant execute on function public.admin_registered_user_count() to admin_ro" in SQL


def test_grants_admin_ro_select_on_eval_candidate_guarded():
    assert "grant select on public.eval_candidate to admin_ro" in SQL
    assert "to_regclass('public.eval_candidate')" in SQL  # safe to apply standalone


def test_does_not_grant_select_on_auth_users():
    # Positive least-privilege assertion: only the aggregate integer leaves auth.
    assert "select on auth.users" not in SQL
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/migrations/test_admin_dashboard.py -v`
Expected: FAIL — `FileNotFoundError` (migration does not exist yet).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260827000000_admin_dashboard.sql
-- Admin console (docs/superpowers/specs/2026-08-27-admin-dashboard-design.md):
-- a scoped registered-user counter + the eval_candidate read the Overview needs.

-- admin_ro cannot read auth.users and we do not want it to. A SECURITY DEFINER
-- function returns ONLY the scalar, so the role gains the count without row
-- access. search_path = '' + fully-qualified auth.users blocks search-path
-- hijacking, exactly as the feedback migration's triggers do.
create or replace function public.admin_registered_user_count()
returns integer
language sql
security definer
stable
set search_path = ''
as $$ select count(*)::integer from auth.users $$;

revoke execute on function public.admin_registered_user_count() from public;
grant execute on function public.admin_registered_user_count() to admin_ro;

-- Overview tallies eval_candidate by status; admin_ro has INSERT but not SELECT
-- on it (20260826130000). Add the read. Guarded so this migration is safe to
-- apply before/independent of the eval_candidate table's own migration.
do $$
begin
  if to_regclass('public.eval_candidate') is not null then
    execute 'grant select on public.eval_candidate to admin_ro';
  end if;
end $$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && uv run pytest tests/migrations/test_admin_dashboard.py -v`
Expected: PASS (4 tests).

---

## Task 2: Overview stats shaper

**Files:**
- Create: `apps/web/app/admin/stats.ts`
- Test: `apps/web/app/admin/__tests__/stats.test.ts`

**Interfaces:**
- Produces:
  - `interface DashboardStatsInput { registeredUsers: number; investigationsTotal: number; feedbackVerdicts: string[]; candidateStatuses: string[] }`
  - `interface DashboardStats { registeredUsers: number; investigationsTotal: number; feedback: { total: number; agree: number; too_high: number; too_low: number }; candidates: { total: number; promoted: number; exported: number } }`
  - `function toDashboardStats(raw: DashboardStatsInput): DashboardStats` — `total` fields are the array lengths; sub-counts tally only recognized enum values (unknown strings ignored).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/admin/__tests__/stats.test.ts
import { describe, it, expect } from "vitest";
import { toDashboardStats } from "../stats";

describe("toDashboardStats", () => {
  it("tallies verdicts and statuses, counting rows in total but ignoring unknown enum values", () => {
    const s = toDashboardStats({
      registeredUsers: 1284,
      investigationsTotal: 57,
      feedbackVerdicts: ["agree", "agree", "too_high", "too_low", "bogus"],
      candidateStatuses: ["promoted", "promoted", "exported", "???"],
    });
    expect(s.registeredUsers).toBe(1284);
    expect(s.investigationsTotal).toBe(57);
    expect(s.feedback).toEqual({ total: 5, agree: 2, too_high: 1, too_low: 1 });
    expect(s.candidates).toEqual({ total: 4, promoted: 2, exported: 1 });
  });

  it("returns all-zero tallies for empty arrays", () => {
    const s = toDashboardStats({ registeredUsers: 0, investigationsTotal: 0, feedbackVerdicts: [], candidateStatuses: [] });
    expect(s.feedback).toEqual({ total: 0, agree: 0, too_high: 0, too_low: 0 });
    expect(s.candidates).toEqual({ total: 0, promoted: 0, exported: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/stats.test.ts`
Expected: FAIL — cannot resolve `../stats`.

- [ ] **Step 3: Write the shaper**

```ts
// apps/web/app/admin/stats.ts
export interface DashboardStatsInput {
  registeredUsers: number;
  investigationsTotal: number;
  feedbackVerdicts: string[];
  candidateStatuses: string[];
}

export interface DashboardStats {
  registeredUsers: number;
  investigationsTotal: number;
  feedback: { total: number; agree: number; too_high: number; too_low: number };
  candidates: { total: number; promoted: number; exported: number };
}

// Pure grouping so it's unit-tested without a database (mirrors toTriageRows).
// `total` reflects the row count; sub-counts tally only recognized enum values,
// so a future enum value is ignored rather than crashing the page.
export function toDashboardStats(raw: DashboardStatsInput): DashboardStats {
  const feedback = { total: raw.feedbackVerdicts.length, agree: 0, too_high: 0, too_low: 0 };
  for (const v of raw.feedbackVerdicts) {
    if (v === "agree" || v === "too_high" || v === "too_low") feedback[v] += 1;
  }
  const candidates = { total: raw.candidateStatuses.length, promoted: 0, exported: 0 };
  for (const s of raw.candidateStatuses) {
    if (s === "promoted" || s === "exported") candidates[s] += 1;
  }
  return { registeredUsers: raw.registeredUsers, investigationsTotal: raw.investigationsTotal, feedback, candidates };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/stats.test.ts`
Expected: PASS (2 tests).

---

## Task 3: Relocate the triage UI, action & redirect the old route

Move the triage code up into `app/admin/`, extract the render into a `FeedbackTriage` component, add a pending-aware Promote button, and turn `/admin/feedback` into a redirect. This retires the old route in one coherent change so no intermediate state has broken imports.

**Files:**
- Create: `apps/web/app/admin/triage.tsx`, `apps/web/app/admin/actions.ts`, `apps/web/app/admin/promote-core.ts`, `apps/web/app/admin/PromoteButton.tsx`
- Replace: `apps/web/app/admin/feedback/page.tsx` (→ redirect)
- Delete: `apps/web/app/admin/feedback/actions.ts`, `apps/web/app/admin/feedback/promote-core.ts`
- Move tests: `apps/web/app/admin/__tests__/triage.test.ts` (from `feedback/__tests__/page.test.ts`), `apps/web/app/admin/__tests__/actions.test.ts` (from `feedback/__tests__/actions.test.ts`)
- Create test: `apps/web/app/admin/feedback/__tests__/redirect.test.ts`
- Delete tests: `apps/web/app/admin/feedback/__tests__/page.test.ts`, `apps/web/app/admin/feedback/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `loadTriage(client) → Promise<TriageResult>`, `toTriageRows(feedback, investigations) → TriageRow[]`, `type TriageResult = { ok: true; rows: TriageRow[] } | { ok: false; error: string }`, `FeedbackTriage({ result }: { result: TriageResult })`, `promote(formData: FormData)`, `buildCandidate`, `PromoteError`, `type Band`.
- Consumes: `supabaseAdmin`, `assertAdmin`/`AdminAccessError`, `Investigation` (all from `apps/web/lib/*`).

- [ ] **Step 1: Move the two existing test files and repoint their imports**

Create `apps/web/app/admin/__tests__/triage.test.ts` with the **exact body** of `feedback/__tests__/page.test.ts`, changing only:
- the mock path `vi.mock("../../../../lib/supabase/admin", ...)` → `vi.mock("../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }))`
- the import `from "../page"` → `from "../triage"`

Create `apps/web/app/admin/__tests__/actions.test.ts` with the **exact body** of `feedback/__tests__/actions.test.ts`, changing only:
- the import `from "../promote-core"` → `from "../promote-core"` (unchanged name) but relative to the new location it stays `../promote-core`
- the type import `from "../../../../lib/investigations"` → `from "../../../lib/investigations"`

Delete `feedback/__tests__/page.test.ts` and `feedback/__tests__/actions.test.ts`.

Also create the redirect test:

```ts
// apps/web/app/admin/feedback/__tests__/redirect.test.ts
import { describe, it, expect, vi } from "vitest";

const redirect = vi.fn(() => {
  throw new Error("REDIRECT"); // Next's redirect() throws to halt rendering
});
vi.mock("next/navigation", () => ({ redirect }));

import AdminFeedbackRedirect from "../page";

describe("/admin/feedback", () => {
  it("permanently redirects to the consolidated /admin console", () => {
    expect(() => AdminFeedbackRedirect()).toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/admin");
  });
});
```

- [ ] **Step 2: Run the moved tests to verify they fail**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/triage.test.ts app/admin/__tests__/actions.test.ts app/admin/feedback/__tests__/redirect.test.ts`
Expected: FAIL — cannot resolve `../triage`, `../promote-core`, and the redirect stub still exports the old triage page.

- [ ] **Step 3: Create the relocated modules**

`apps/web/app/admin/promote-core.ts` — **identical** to `feedback/promote-core.ts`, changing only the Investigation import from `../../../lib/investigations` to `../../lib/investigations`.

```ts
// apps/web/app/admin/actions.ts
"use server";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertAdmin, AdminAccessError } from "../../lib/admin/access";
import { supabaseAdmin } from "../../lib/supabase/admin";
import type { Investigation } from "../../lib/investigations";
import { buildCandidate, PromoteError, type Band } from "./promote-core";

export async function promote(formData: FormData) {
  let email: string;
  try {
    email = await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }
  const investigationId = String(formData.get("investigation_id") ?? "");
  const expectedMaxBand = String(formData.get("expected_max_band") ?? "") as Band;
  const wrongFindingId = (formData.get("wrong_finding_id") as string | null) || null;
  const tags = String(formData.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);

  const { data: inv, error } = await supabaseAdmin
    .from("investigations")
    .select("id, submission, findings")
    .eq("id", investigationId)
    .single();
  if (error || !inv) throw new PromoteError(`investigation ${investigationId} not found`);

  const candidate = buildCandidate(inv as unknown as Investigation, {
    expectedMaxBand, tags, wrongFindingId, promotedBy: email,
  });

  // admin_ro has INSERT but NO SELECT on eval_candidate for the write path —
  // never chain .select() here, it would 403 at runtime.
  const { error: insErr } = await supabaseAdmin.from("eval_candidate").insert(candidate);
  if (insErr) throw new PromoteError(insErr.message);

  revalidatePath("/admin"); // the console now hosts the queue
}
```

```tsx
// apps/web/app/admin/PromoteButton.tsx
"use client";
import { useFormStatus } from "react-dom";

// Client submit button so the operator's repeated action feels responsive:
// press-scale (Emil) + disabled/aria-busy while the server action runs, so a
// double-click can't double-promote.
export function PromoteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="border border-ink px-3 py-1 text-[12px] transition-transform duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55"
    >
      {pending ? "Promoting…" : "Promote"}
    </button>
  );
}
```

```tsx
// apps/web/app/admin/triage.tsx
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import { promote } from "./actions";
import { PromoteButton } from "./PromoteButton";

type FeedbackRow = Database["public"]["Tables"]["feedback"]["Row"];
type InvSlim = { id: string; submission: unknown; assessment: unknown; findings: { id: string; claim: string }[] | null };

export interface TriageRow {
  feedback: FeedbackRow;
  investigation: InvSlim | null;
}

// Pure join, newest feedback first (unit-tested without rendering).
export function toTriageRows(feedback: FeedbackRow[], investigations: InvSlim[]): TriageRow[] {
  const byId = new Map(investigations.map((i) => [i.id, i]));
  return [...feedback]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((f) => ({ feedback: f, investigation: byId.get(f.investigation_id) ?? null }));
}

export type TriageResult =
  | { ok: true; rows: TriageRow[] }
  | { ok: false; error: string };

// Loads the triage queue, keeping a read FAILURE distinct from an empty queue.
export async function loadTriage(client: SupabaseClient<Database>): Promise<TriageResult> {
  const { data: feedback, error: fErr } = await client
    .from("feedback")
    .select("id, investigation_id, user_id, verdict, wrong_finding_id, note, created_at")
    .order("created_at", { ascending: false });
  if (fErr) return { ok: false, error: `feedback read failed: ${fErr.message}` };

  const invIds = [...new Set((feedback ?? []).map((f) => f.investigation_id))];
  const { data: investigations, error: iErr } = await client
    .from("investigations")
    .select("id, submission, assessment, findings")
    .in("id", invIds.length ? invIds : ["00000000-0000-0000-0000-000000000000"]);
  if (iErr) return { ok: false, error: `investigations read failed: ${iErr.message}` };

  return { ok: true, rows: toTriageRows((feedback ?? []) as FeedbackRow[], (investigations ?? []) as InvSlim[]) };
}

// Presentational: the console supplies the <section>/<h2> wrapper. Renders the
// read-failure banner, the empty state, or the queue — each row's Promote form.
export function FeedbackTriage({ result }: { result: TriageResult }) {
  if (!result.ok) {
    return (
      <p className="border border-rule-soft bg-red-50 p-4 font-mono text-[12px] text-red-700">
        Read failed — the queue could not be loaded, so this is NOT necessarily empty. {result.error}
      </p>
    );
  }
  if (result.rows.length === 0) {
    return <p className="text-[13px] text-muted">No feedback yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-6">
      {result.rows.map(({ feedback: f, investigation: inv }) => (
        <li key={f.id} className="border border-rule-soft p-4">
          <div className="font-mono text-[11px] text-muted">
            {f.verdict} · {f.created_at}
            {f.wrong_finding_id ? ` · finding ${f.wrong_finding_id}` : ""}
          </div>
          {f.note && <p className="mt-2 text-[13px]">{f.note}</p>}
          <pre className="mt-2 overflow-x-auto text-[11px]">{JSON.stringify(inv?.submission ?? {}, null, 2)}</pre>
          <form action={promote} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="investigation_id" value={f.investigation_id} />
            <input type="hidden" name="wrong_finding_id" value={f.wrong_finding_id ?? ""} />
            <label className="text-[12px]">
              expected_max_band
              <select name="expected_max_band" className="ml-1 border border-rule-soft p-1">
                <option>LOW</option>
                <option>MODERATE</option>
                <option>HIGH</option>
                <option>CRITICAL</option>
              </select>
            </label>
            <label className="text-[12px]">
              tags
              <input name="tags" placeholder="legit, staffing_agency" className="ml-1 border border-rule-soft p-1" />
            </label>
            <PromoteButton />
          </form>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// apps/web/app/admin/feedback/page.tsx  (replaces the old triage page)
import { redirect } from "next/navigation";

// /admin/feedback consolidated into the /admin console (2026-08-27). Kept as a
// permanent redirect so old bookmarks and in-product links don't 404.
export default function AdminFeedbackRedirect() {
  redirect("/admin"); // issues 308
}
```

Delete `app/admin/feedback/actions.ts` and `app/admin/feedback/promote-core.ts`.

- [ ] **Step 4: Run the moved + redirect tests to verify they pass**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/triage.test.ts app/admin/__tests__/actions.test.ts app/admin/feedback/__tests__/redirect.test.ts`
Expected: PASS — `toTriageRows`/`loadTriage` behavior preserved through the move, `buildCandidate`/`PromoteError` unchanged, redirect targets `/admin`.

---

## Task 4: Overview grid (presentational)

**Files:**
- Create: `apps/web/app/admin/OverviewGrid.tsx`
- Test: `apps/web/app/admin/__tests__/overview-grid.test.tsx`

**Interfaces:**
- Consumes: `DashboardStats` from `./stats`.
- Produces: `function OverviewGrid({ stats }: { stats: DashboardStats })` — a `<dl>` hairline grid; numbers formatted with `toLocaleString()`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/admin/__tests__/overview-grid.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewGrid } from "../OverviewGrid";
import type { DashboardStats } from "../stats";

const STATS: DashboardStats = {
  registeredUsers: 1284,
  investigationsTotal: 57,
  feedback: { total: 9, agree: 5, too_high: 3, too_low: 1 },
  candidates: { total: 4, promoted: 3, exported: 1 },
};

describe("OverviewGrid", () => {
  it("renders every headline number, locale-formatted, with its label", () => {
    render(<OverviewGrid stats={STATS} />);
    expect(screen.getByText((1284).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("57")).toBeInTheDocument();
    expect(screen.getByText("Registered users")).toBeInTheDocument();
    expect(screen.getByText("Investigations")).toBeInTheDocument();
  });

  it("renders the verdict and status sub-counts", () => {
    render(<OverviewGrid stats={STATS} />);
    expect(screen.getByText(/agree 5 · too_high 3 · too_low 1/)).toBeInTheDocument();
    expect(screen.getByText(/promoted 3 · exported 1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/overview-grid.test.tsx`
Expected: FAIL — cannot resolve `../OverviewGrid`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/admin/OverviewGrid.tsx
import type { DashboardStats } from "./stats";

// Hairline datasheet grid: gap-px over a rule-colored bg paints continuous 1px
// seams between cards (no shadows, no radius — handoff tokens). Modeled as a
// <dl>: each metric is a <dt> label described by a <dd> value.
export function OverviewGrid({ stats }: { stats: DashboardStats }) {
  const n = (v: number) => v.toLocaleString();
  return (
    <dl className="grid grid-cols-1 gap-px border border-rule-soft bg-rule-soft sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Registered users" value={n(stats.registeredUsers)} />
      <Card label="Investigations" value={n(stats.investigationsTotal)} />
      <Card
        label="Feedback"
        value={n(stats.feedback.total)}
        sub={`agree ${stats.feedback.agree} · too_high ${stats.feedback.too_high} · too_low ${stats.feedback.too_low}`}
      />
      <Card
        label="Eval candidates"
        value={n(stats.candidates.total)}
        sub={`promoted ${stats.candidates.promoted} · exported ${stats.candidates.exported}`}
      />
    </dl>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-h-[132px] bg-page p-6">
      <dt className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-3 font-mono text-[40px] leading-none tabular-nums text-ink">{value}</dd>
      {sub && <dd className="mt-3 font-mono text-[12px] text-muted">{sub}</dd>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/overview-grid.test.tsx`
Expected: PASS (2 tests).

---

## Task 5: Admin top bar + layout

**Files:**
- Create: `apps/web/app/admin/AdminHeader.tsx`, `apps/web/app/admin/layout.tsx`
- Test: `apps/web/app/admin/__tests__/admin-header.test.tsx`

**Interfaces:**
- Produces: `function AdminHeader()` (server component); default `AdminLayout({ children })`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/admin/__tests__/admin-header.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminHeader } from "../AdminHeader";

describe("AdminHeader", () => {
  it("marks the surface as Admin and offers skip + section anchors", () => {
    render(<AdminHeader />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "#overview");
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "#feedback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/admin-header.test.tsx`
Expected: FAIL — cannot resolve `../AdminHeader`.

- [ ] **Step 3: Write the header and layout**

```tsx
// apps/web/app/admin/AdminHeader.tsx
// Minimal admin top bar. Server component: admin identity is already proven at
// the CF Access edge, so no client JS, no account menu, no CTA. Reuses
// SiteHeader's shell tokens; two in-page anchors jump to the console sections.
export function AdminHeader() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:border focus:border-ink focus:bg-page focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-rule bg-page">
        <div className="mx-auto flex h-[66px] max-w-page items-center px-8 max-[430px]:px-5">
          <span className="flex items-center gap-3">
            <span className="h-[13px] w-[13px] bg-ink" aria-hidden="true" />
            <span className="text-[17px] font-bold tracking-[-0.015em]">Jobverifai</span>
            <span className="font-mono text-[11px] text-muted">Admin</span>
          </span>
          <nav className="ml-auto flex items-center gap-6">
            <a href="#overview" className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink">
              Overview
            </a>
            <a href="#feedback" className="text-[13px] text-secondary transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover:text-ink">
              Feedback
            </a>
          </nav>
        </div>
      </header>
    </>
  );
}
```

```tsx
// apps/web/app/admin/layout.tsx
import { AdminHeader } from "./AdminHeader";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader />
      {children}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/admin-header.test.tsx`
Expected: PASS.

---

## Task 6: The console page (wiring)

**Files:**
- Create: `apps/web/app/admin/page.tsx`
- Test: `apps/web/app/admin/__tests__/page.test.ts`

**Interfaces:**
- Consumes: `assertAdmin`/`AdminAccessError`, `supabaseAdmin`, `Database`, `toDashboardStats`/`DashboardStats`, `loadTriage`/`FeedbackTriage`/`TriageResult`, `OverviewGrid`.
- Produces: `async function loadConsole(client): Promise<{ stats: DashboardStats; triage: TriageResult }>` (exported for tests); default `AdminConsolePage()`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/admin/__tests__/page.test.ts
import { describe, it, expect, vi } from "vitest";

// page.tsx imports supabaseAdmin (real client at load) → stub it. It also
// pulls the "use server" action chain via ./triage; stub the auth + nav modules
// so the non-admin path is exercisable without a request context.
vi.mock("../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound, redirect: vi.fn() }));
vi.mock("../../../lib/admin/access", () => {
  class AdminAccessError extends Error {}
  return { AdminAccessError, assertAdmin: vi.fn(async () => { throw new AdminAccessError("denied"); }) };
});

import AdminConsolePage, { loadConsole } from "../page";

// A chainable PostgREST stand-in covering all four reads.
function fakeClient() {
  return {
    from(table: string) {
      if (table === "feedback") {
        return { select: () => ({ order: () => Promise.resolve({ data: [
          { id: "fb1", investigation_id: "inv1", verdict: "agree", wrong_finding_id: null, note: null, created_at: "2026-08-26T00:00:00Z" },
        ], error: null }) }) };
      }
      if (table === "investigations") {
        return {
          select: (_cols: string, opts?: { head?: boolean }) =>
            opts?.head
              ? Promise.resolve({ count: 57, error: null })
              : { in: () => Promise.resolve({ data: [{ id: "inv1", submission: {}, assessment: {}, findings: [] }], error: null }) },
        };
      }
      if (table === "eval_candidate") {
        return { select: () => Promise.resolve({ data: [{ status: "promoted" }, { status: "exported" }], error: null }) };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: 1284, error: null }),
  } as never;
}

describe("loadConsole", () => {
  it("assembles Overview stats from all four reads and returns the triage result", async () => {
    const { stats, triage } = await loadConsole(fakeClient());
    expect(stats.registeredUsers).toBe(1284);
    expect(stats.investigationsTotal).toBe(57);
    expect(stats.feedback).toEqual({ total: 1, agree: 1, too_high: 0, too_low: 0 });
    expect(stats.candidates).toEqual({ total: 2, promoted: 1, exported: 1 });
    expect(triage.ok).toBe(true);
  });

  it("coalesces failed reads to zero and derives no verdicts from a failed triage read", async () => {
    const broken = {
      from(table: string) {
        if (table === "feedback") return { select: () => ({ order: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) };
        if (table === "investigations") return { select: () => Promise.resolve({ count: null, error: { message: "boom" } }) };
        if (table === "eval_candidate") return { select: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
        return {};
      },
      rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    } as never;
    const { stats, triage } = await loadConsole(broken);
    expect(stats.registeredUsers).toBe(0);
    expect(stats.investigationsTotal).toBe(0);
    expect(stats.feedback.total).toBe(0);
    expect(stats.candidates.total).toBe(0);
    expect(triage.ok).toBe(false);
  });
});

describe("AdminConsolePage auth", () => {
  it("maps AdminAccessError to notFound (404, never 403)", async () => {
    await expect(AdminConsolePage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/page.test.ts`
Expected: FAIL — cannot resolve `../page` (or missing `loadConsole` export).

- [ ] **Step 3: Write the console page**

```tsx
// apps/web/app/admin/page.tsx
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin, AdminAccessError } from "../../lib/admin/access";
import { supabaseAdmin } from "../../lib/supabase/admin";
import type { Database } from "../../lib/database.types";
import { toDashboardStats, type DashboardStats } from "./stats";
import { loadTriage, FeedbackTriage, type TriageResult } from "./triage";
import { OverviewGrid } from "./OverviewGrid";

// Each read coalesces its own failure to an empty/zero value (spec Error
// Handling): one broken read shows a 0 card, never throws, never blanks the
// page. The verdict tally is derived from the rows loadTriage already fetched —
// no duplicate feedback query.
export async function loadConsole(
  client: SupabaseClient<Database>,
): Promise<{ stats: DashboardStats; triage: TriageResult }> {
  const [triage, candidateStatuses, investigationsTotal, registeredUsers] = await Promise.all([
    loadTriage(client),
    readCandidateStatuses(client),
    readInvestigationsCount(client),
    readRegisteredUsers(client),
  ]);
  const feedbackVerdicts = triage.ok ? triage.rows.map((r) => r.feedback.verdict) : [];
  const stats = toDashboardStats({ registeredUsers, investigationsTotal, feedbackVerdicts, candidateStatuses });
  return { stats, triage };
}

async function readCandidateStatuses(client: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await client.from("eval_candidate").select("status");
  return (data ?? []).map((r) => r.status as string);
}
async function readInvestigationsCount(client: SupabaseClient<Database>): Promise<number> {
  const { count } = await client.from("investigations").select("*", { head: true, count: "exact" });
  return count ?? 0;
}
async function readRegisteredUsers(client: SupabaseClient<Database>): Promise<number> {
  const { data } = await client.rpc("admin_registered_user_count");
  return typeof data === "number" ? data : 0;
}

export default async function AdminConsolePage() {
  try {
    await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }
  const { stats, triage } = await loadConsole(supabaseAdmin);
  return (
    <main id="main-content" className="mx-auto max-w-page px-8 py-16 max-[430px]:px-5">
      <h1 className="sr-only">Admin console</h1>
      <section id="overview">
        <h2 className="text-lg font-semibold">Overview</h2>
        <p className="mt-1 font-mono text-[12px] text-muted">All-time totals</p>
        <div className="mt-6">
          <OverviewGrid stats={stats} />
        </div>
      </section>
      <section id="feedback" className="mt-16 border-t border-rule-soft pt-16">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <div className="mt-6">
          <FeedbackTriage result={triage} />
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/admin/__tests__/page.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full admin suite + typecheck**

Run: `cd apps/web && pnpm vitest run app/admin && pnpm exec tsc --noEmit`
Expected: all admin tests PASS; no type errors (the retired `feedback/actions.ts`/`promote-core.ts` are gone and nothing imports them).

---

## Notes on spec coverage

- **"Page renders each headline number and the triage rows"** (spec Testing): satisfied by the `OverviewGrid` render test (headline numbers + sub-counts) and the relocated/rendered `FeedbackTriage` (queue rows), rather than by rendering the async page — matching the repo convention of testing pure shapers + prop-driven components and leaving async orchestration to the auth-path test. `loadConsole` covers the data assembly and the error-coalescing path.
- **Optional first-paint stagger** and **`<Suspense>` streaming** are documented in the spec as YAGNI-deferred; this plan ships neither (Overview is four light reads). If added later, gate the stagger behind `prefers-reduced-motion` in CSS.
