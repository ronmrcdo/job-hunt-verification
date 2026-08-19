# V1 Web ⇄ Supabase Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `apps/web` off the V0 REST API + owner-key onto Supabase (Auth, RLS data access, Realtime), with an SSR session layer, react-hook-form/zod validation, and a unified investigation view.

**Architecture:** `@supabase/ssr` provides cookie sessions; Next.js middleware refreshes tokens and guards `/verify` + `/investigations/*`. Submit is an RLS `insert`; reads are SELECT-first with a Realtime overlay for live steps. One `/investigations/[id]` route switches on `status` (checklist | report | failed). The V0 web data layer is deleted, unblocking the backend teardown on this branch.

**Tech Stack:** Next.js 16 (App Router, SSR), React 19, `@supabase/supabase-js`, `@supabase/ssr`, `react-hook-form` + `zod` + `@hookform/resolvers`, Tailwind CSS v4, Framer Motion, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-19-v1-web-supabase-integration-design.md` — read it alongside this plan; tasks argue from its numbered sections (§).

## Global Constraints

- **NEVER touch a live database or run Supabase.** Do not run `supabase start`, `supabase db push/reset`, `supabase migration up`, `supabase gen types`, `psql`, or `npx inngest-cli`. Migration/SQL files are **authored and reviewed only**; the operator (Ron) applies them. (Backend spec §5, §9.)
- **No commit steps.** This plan omits `git commit` entirely (Ron's rule). The operator commits. Do not add commit steps or pass `--author`/`Co-Authored-By`.
- **Design tokens are FINAL** (memory `frontend-design-token-authority`): Helvetica/Arial + JetBrains Mono, `border-radius: 0`, shadows only on the four band cards, no gradients/images, one accent family. Do not restyle; only rewire data + add auth/validation. Tests assert roles/text/`data-*`, **never Tailwind class names**. `MotionGlobalConfig.skipAnimations = true` stays in `vitest.setup.ts`.
- **Product rules stay enforced** (memory `frontend-api-reconciliation`): band is never a score; confidence is separate; URLs always defanged and never links; conversation provenance label on `provenance === "user_provided_unverified"`; neutral "couldn't verify" copy. The product-rules guardrail suite must stay green.
- **Job-text cap = 40 000 chars.** `submissionSchema` mirrors the DB CHECK (`job_text` present, 1–40 000). (Backend spec §4.)
- **Statuses:** investigation `queued → running → done | failed | deadline_exceeded`; step `pending | running | done | skipped | failed`. (Backend spec §3, §5.)
- **Password never enters flow state or storage.** It lives only in `AuthForm` local state and is passed straight to Supabase. (Spec §5.1.)
- **No live-DB in tests.** Mock `@supabase/ssr` / supabase-js at the module boundary. Fixtures survive as test data only; there is **no runtime mock mode**.
- Node/pnpm workspace. Web tests run from `apps/web` with `npm test` (`vitest run`). Type-check with `npx tsc --noEmit`.

---

## File Structure

**Created (web)**
- `apps/web/lib/supabase/client.ts` — browser client (`createBrowserClient`).
- `apps/web/lib/supabase/server.ts` — server client (`createServerClient` + `cookies()`).
- `apps/web/lib/supabase/middleware.ts` — `updateSession` token-refresh helper.
- `apps/web/middleware.ts` — root middleware: session refresh + route guard.
- `apps/web/lib/database.types.ts` — hand-authored table types (operator regenerates).
- `apps/web/lib/investigations.ts` — data access: `createInvestigation`, `getInvestigation`, `recentInvestigations` + types.
- `apps/web/lib/investigations-live.ts` — pure reducers `applyStepEvent`/`applyStatusEvent` + `useInvestigationLive` hook.
- `apps/web/lib/validation.ts` — `submissionSchema`, `authSchema` (zod).
- `apps/web/app/auth/callback/route.ts` — OAuth / email-confirm code exchange.
- `apps/web/app/verify/page.tsx` — authed home (server): new-check form + recent strip.
- `apps/web/components/verify/NewCheckForm.tsx` — paste + details, RHF+zod → insert → navigate.
- `apps/web/components/verify/RecentChecks.tsx` — recent-checks strip.
- `apps/web/components/investigation/InvestigationView.tsx` — client: `useInvestigationLive` + status switch.
- `apps/web/app/investigations/[id]/page.tsx` — server SELECT-first, renders `InvestigationView`.

**Modified (web)**
- `apps/web/package.json` — add supabase/rhf/zod deps; remove `@job-hunt/api-types`.
- `apps/web/components/auth/AuthForm.tsx` — real Supabase auth + Google + RHF/zod.
- `apps/web/app/sign-in/page.tsx` — wire to real auth; redirect to `/verify` (or draft resume).
- `apps/web/components/site/SiteHeader.tsx` — session-driven sign-in/out.
- `apps/web/lib/flow-context.tsx` — trim to pre-auth draft carry only.
- `apps/web/lib/report-view-model.ts` — take DB row shape instead of `Investigation` REST type.
- `apps/web/app/page.tsx` — landing "Start" routes into the auth flow (draft carried).
- Report/landing/details/progress fixtures + tests — shift to DB row shape.

**Deleted (web)**
- `apps/web/lib/ownerKey.ts`, `apps/web/lib/api.ts`.
- `apps/web/app/check/new/`, `apps/web/app/check/running/`, `apps/web/app/report/[id]/`.
- The `apps/web/app/investigations/[id]` redirect shim (replaced by the real view).
- `apps/web/components/progress/progress-script.ts` and its scripted-animation usages.

**Modified (backend — sources column, per spec §4.4 resolution)**
- `supabase/migrations/20260819080000_investigations_sources.sql` — **create**: add `sources jsonb` column.
- `apps/api/src/app/worker/persistence.py` — `persist_result` also writes `sources`.
- `apps/api/tests/worker/test_persistence.py` — assert sources persisted.

---

## Task 1: Backend `sources` column (authored migration + worker write)

Resolves the spec §4.4 sources gap: V1 persists no client-readable sources, but the report renders per-finding source excerpts. Add a `sources jsonb` column and have the worker write the already-shaped sources into it.

**Files:**
- Create: `supabase/migrations/20260819080000_investigations_sources.sql`
- Modify: `apps/api/src/app/worker/persistence.py`
- Modify: `scripts/verify_rls.sql` (operator RLS script — extend for the new column)
- Test: `apps/api/tests/worker/test_persistence.py`

**Interfaces:**
- Produces: `investigations.sources jsonb` (nullable), nulled on insert by the defaults trigger, written by `persist_result`. Consumed by the web `getInvestigation` (Task 5) as `row.sources: Source[] | null`.

**RLS note:** `sources` is a new column on the already-RLS-enabled `investigations` table. RLS is table-level, so it inherits the existing policies (`investigations_insert_own` INSERT, `investigations_select_own` SELECT, **no** UPDATE/DELETE policies). No new policy is required. Client-writability is closed two ways — the `force_investigation_defaults` trigger nulls `sources` on INSERT, and there is no UPDATE policy — so only the service-role worker can ever populate it. Step 6 adds an operator assertion proving this.

- [ ] **Step 1: Author the migration (authored only — never applied here)**

Create `supabase/migrations/20260819080000_investigations_sources.sql`:

```sql
-- supabase/migrations/20260819080000_investigations_sources.sql
-- Adds the client-readable, already-shaped sources array to investigations.
-- The worker's persist_result() is the ONLY writer (spec §3 write-time shaping:
-- excerpted <=500 chars + defanged). Nulled on insert by force_investigation_defaults.
-- OPERATOR: apply after 20260819073420_investigations_v1.sql. Not run by the implementation.

alter table investigations add column if not exists sources jsonb;

-- Extend the insert-defaults trigger so a client cannot seed sources either.
create or replace function force_investigation_defaults()
returns trigger language plpgsql as $$
begin
  new.status := 'queued';
  new.check_count := null;
  new.assessment := null;
  new.findings := null;
  new.sources := null;
  new.cost := null;
  new.what_to_verify := null;
  return new;
end $$;
```

Add a `-- NOTE:` line: the `investigations` table is already in `supabase_realtime` (v1 migration), so no publication change is needed for the new column.

- [ ] **Step 2: Write the failing persistence test**

In `apps/api/tests/worker/test_persistence.py`, append a test asserting `persist_result` emits an UPDATE that sets `sources` with shaped (defanged, capped) JSON. Reuse the file's existing `FakePool`/`FakeConn` (which record `(sql_prefix, params)` tuples):

```python
async def test_persist_result_writes_shaped_sources(monkeypatch):
    from app.worker.persistence import Persistence
    from app.graph.state import Source
    from datetime import datetime, timezone
    pool = FakePool()
    async def fake_get_pool(): return pool
    monkeypatch.setattr("app.worker.persistence.db.get_pool", fake_get_pool)
    src = Source(id="s1", url="http://evil.example/x", kind="fetched_page",
                 retrieved_at=datetime.now(timezone.utc), content_summary="c",
                 raw_excerpt="go http://evil.example " + "A" * 1000)
    p = Persistence()
    await p.persist_result(uuid.uuid4(), assessment=None, findings=[], sources=[src],
                           cost={}, what_to_verify=[], check_count=None)
    update = next(c for c in pool.store if "UPDATE INVESTIGATIONS" in c[0].upper())
    joined = " ".join(str(x) for x in update).lower()
    assert "sources" in joined
    assert "http://" not in joined            # defanged
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd apps/api && uv run pytest tests/worker/test_persistence.py::test_persist_result_writes_shaped_sources -v`
Expected: FAIL — `sources` not in the emitted UPDATE.

- [ ] **Step 4: Add `sources` to the `persist_result` UPDATE**

In `apps/api/src/app/worker/persistence.py`, change `persist_result` to include the column (sources are already shaped by `shape()` at the top of the method):

```python
        async with pool.connection() as c:
            await c.execute(
                "UPDATE investigations SET assessment=%s, findings=%s, sources=%s, cost=%s, "
                "what_to_verify=%s, check_count=%s WHERE id=%s",
                (json.dumps(assessment.model_dump(mode="json")) if assessment else None,
                 json.dumps([f.model_dump(mode="json") for f in findings]),
                 json.dumps([s.model_dump(mode="json") for s in sources]),
                 json.dumps(cost), json.dumps(what_to_verify), check_count, inv_id))
```

- [ ] **Step 5: Run the worker suite, verify green**

Run: `cd apps/api && uv run pytest tests/worker/test_persistence.py -v`
Expected: PASS (new test + existing shaping/upsert/backfill tests).

- [ ] **Step 6: Extend the operator RLS script for the new column (authored only)**

Append to `scripts/verify_rls.sql` a `DO $$ … $$` block (operator-run, never run here) asserting the `sources` column is not client-writable — the same guarantee the existing cases assert for `status`/`assessment`. As authenticated user A:

```sql
-- CASE 7 (sources column, gap follow-up): a client cannot seed `sources` on
-- INSERT (defaults trigger nulls it), and cannot UPDATE it (no UPDATE policy).
do $$
declare v_id uuid;
begin
  -- INSERT attempting to set sources → trigger forces it to NULL.
  insert into investigations (submission, sources)
    values ('{"job_text":"x"}'::jsonb, '[{"id":"s1"}]'::jsonb)
    returning id into v_id;
  if (select sources from investigations where id = v_id) is not null then
    raise exception 'RLS/defaults FAIL: client seeded sources on insert';
  end if;

  -- UPDATE attempting to set sources → denied by absence of an UPDATE policy
  -- (0 rows affected, not an error). Assert the value is still NULL.
  update investigations set sources = '[{"id":"s2"}]'::jsonb where id = v_id;
  if (select sources from investigations where id = v_id) is not null then
    raise exception 'RLS FAIL: client updated sources';
  end if;
end $$;
```

Add a one-line pointer in `scripts/RUNBOOK.md`'s verification section noting CASE 7 covers the `sources` column. Do **not** run the script (Global Constraint — operator-only).


---

## Task 2: Dependencies, Supabase clients & env

Installs the libraries and the SSR client seam (spec §4.1, §9). No behavior change yet; the deliverable is importable clients + a documented env.

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/supabase/client.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/middleware.ts`
- Create: `apps/web/.env.example`, `apps/web/README.md` (env section)

**Interfaces:**
- Produces: `createClient()` (browser) from `client.ts`; `createClient()` (async, server) from `server.ts`; `updateSession(request: NextRequest): Promise<NextResponse>` from `supabase/middleware.ts`. Consumed by every later task.

- [ ] **Step 1: Add/remove dependencies**

Edit `apps/web/package.json`: add to `dependencies` `"@supabase/supabase-js": "^2.45.0"`, `"@supabase/ssr": "^0.5.0"`, `"react-hook-form": "^7.53.0"`, `"zod": "^3.23.0"`, `"@hookform/resolvers": "^3.9.0"`; **remove** `"@job-hunt/api-types": "workspace:*"`.
Run: `cd apps/web && pnpm install` (dependency resolution only — no DB).
Expected: lockfile updates; install succeeds. (If `@job-hunt/api-types` is still imported anywhere, that's fixed in Tasks 6–8; a temporary type error is acceptable until then — do not add the dep back.)

- [ ] **Step 2: Browser client**

Create `apps/web/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../database.types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

(`database.types` is authored in Task 5 Step 1; if executing strictly in order, create that file first or accept a transient missing-module error resolved in Task 5.)

- [ ] **Step 3: Server client**

Create `apps/web/lib/supabase/server.ts` (App Router cookie wiring):

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "../database.types";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — safe to ignore; middleware refreshes.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: Middleware session helper**

Create `apps/web/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "../database.types";

// Refreshes the auth token and mirrors cookies onto the response, then applies
// the route guard for protected paths (spec §3). Returns the response to send.
const PROTECTED = ["/verify", "/investigations"];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  return response;
}
```

- [ ] **Step 5: Document env**

Create `apps/web/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key
```

Create or append `apps/web/README.md` with a short "Environment" section naming both vars, stating they come from `supabase status` locally (operator-run), and that Google OAuth is configured in the Supabase project by the operator (spec §9). No secret values in the repo.


---

## Task 3: Root middleware + validation schemas

Wires the middleware into Next and lands the zod schemas (spec §3, §5.2). Two small, independently testable units grouped because neither carries a meaningful standalone review.

**Files:**
- Create: `apps/web/middleware.ts`
- Create: `apps/web/lib/validation.ts`
- Test: `apps/web/lib/__tests__/validation.test.ts`

**Interfaces:**
- Consumes: `updateSession` (Task 2).
- Produces: `submissionSchema`, `authSchema` (zod schemas) and inferred types `SubmissionInput`, `AuthInput`. Consumed by `NewCheckForm` (Task 7) and `AuthForm` (Task 6).

- [ ] **Step 1: Root middleware**

Create `apps/web/middleware.ts`:

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Run on everything except static assets and images (standard Supabase matcher).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: Write the failing validation test**

Create `apps/web/lib/__tests__/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { submissionSchema, authSchema } from "../validation";

describe("submissionSchema", () => {
  it("requires non-empty job_text within 40000 chars", () => {
    expect(submissionSchema.safeParse({ job_text: "" }).success).toBe(false);
    expect(submissionSchema.safeParse({ job_text: "a".repeat(40001) }).success).toBe(false);
    expect(submissionSchema.safeParse({ job_text: "real posting" }).success).toBe(true);
  });
  it("accepts optional company/email/url and rejects a malformed email", () => {
    expect(
      submissionSchema.safeParse({ job_text: "x", recruiter_email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      submissionSchema.safeParse({ job_text: "x", company_name: "Acme", job_url: "https://acme.com" })
        .success,
    ).toBe(true);
  });
  it("treats blank optional fields as absent", () => {
    const r = submissionSchema.safeParse({ job_text: "x", recruiter_email: "", job_url: "" });
    expect(r.success).toBe(true);
  });
});

describe("authSchema", () => {
  it("requires a valid email and 8+ char password", () => {
    expect(authSchema.safeParse({ email: "a@b.com", password: "1234567" }).success).toBe(false);
    expect(authSchema.safeParse({ email: "bad", password: "12345678" }).success).toBe(false);
    expect(authSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/validation.test.ts`
Expected: FAIL — cannot resolve `../validation`.

- [ ] **Step 4: Implement the schemas**

Create `apps/web/lib/validation.ts`:

```ts
import { z } from "zod";

// Blank optional strings coerce to undefined so empty inputs don't fail
// url()/email() and aren't sent as "" on insert.
const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const submissionSchema = z.object({
  job_text: z.string().trim().min(1, "Paste the posting.").max(40000, "That posting is too long."),
  company_name: optionalTrimmed,
  recruiter_email: optionalTrimmed.pipe(z.string().email().optional()),
  job_url: optionalTrimmed.pipe(z.string().url().optional()),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const authSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "At least 8 characters."),
});
export type AuthInput = z.infer<typeof authSchema>;
```

- [ ] **Step 5: Run it, verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/validation.test.ts`
Expected: PASS.


---

## Task 4: Realtime reducers + live hook

Isolates the step/status merge logic as pure functions (spec §4.3) so it's unit-testable without a socket; the hook wraps subscription lifecycle around them.

**Files:**
- Create: `apps/web/lib/investigations-live.ts`
- Test: `apps/web/lib/__tests__/investigations-live.test.ts`

**Interfaces:**
- Consumes: `InvestigationStep`, `Investigation` types (Task 5 Step 1). If executing in order, author Task 5 Step 1's `database.types.ts`/`investigations.ts` types first, or define the two row types locally and re-export. This plan assumes the types exist; the reducer signatures are:
- Produces:
  - `applyStepEvent(steps: InvestigationStep[], row: InvestigationStep): InvestigationStep[]` — upsert by `step_key`, re-sorted by `display_order`.
  - `applyStatusEvent(inv: Investigation, row: Partial<Investigation>): Investigation` — merge the row's new status/columns.
  - `isTerminal(status: string): boolean` — `status ∈ {done, failed, deadline_exceeded}`.
  - `useInvestigationLive(id, initial): { investigation, steps }` — subscribes while non-terminal; re-SELECTs on terminal/channel error. Consumed by `InvestigationView` (Task 9).

- [ ] **Step 1: Write the failing reducer test**

Create `apps/web/lib/__tests__/investigations-live.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyStepEvent, applyStatusEvent, isTerminal } from "../investigations-live";
import type { InvestigationStep, Investigation } from "../investigations";

const step = (k: string, order: number, status: string): InvestigationStep => ({
  investigation_id: "i1",
  step_key: k,
  label: k,
  display_order: order,
  status,
  started_at: null,
  finished_at: null,
});

describe("applyStepEvent", () => {
  it("inserts a new step and keeps display_order sorting", () => {
    const out = applyStepEvent([step("b", 2, "pending")], step("a", 1, "running"));
    expect(out.map((s) => s.step_key)).toEqual(["a", "b"]);
  });
  it("updates an existing step in place by step_key", () => {
    const out = applyStepEvent([step("a", 1, "pending")], step("a", 1, "done"));
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("done");
  });
});

describe("applyStatusEvent", () => {
  it("merges the new status without dropping other fields", () => {
    const inv = { id: "i1", status: "running", check_count: 3 } as Investigation;
    expect(applyStatusEvent(inv, { status: "done" })).toMatchObject({ status: "done", check_count: 3 });
  });
});

describe("isTerminal", () => {
  it("is true for done/failed/deadline_exceeded only", () => {
    expect(["done", "failed", "deadline_exceeded"].every(isTerminal)).toBe(true);
    expect(["queued", "running"].some(isTerminal)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/investigations-live.test.ts`
Expected: FAIL — cannot resolve `../investigations-live`.

- [ ] **Step 3: Implement reducers + hook**

Create `apps/web/lib/investigations-live.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { getInvestigation, type Investigation, type InvestigationStep } from "./investigations";

const TERMINAL = new Set(["done", "failed", "deadline_exceeded"]);
export function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export function applyStepEvent(
  steps: InvestigationStep[],
  row: InvestigationStep,
): InvestigationStep[] {
  const next = steps.filter((s) => s.step_key !== row.step_key);
  next.push(row);
  next.sort((a, b) => a.display_order - b.display_order);
  return next;
}

export function applyStatusEvent(inv: Investigation, row: Partial<Investigation>): Investigation {
  return { ...inv, ...row };
}

export function useInvestigationLive(
  id: string,
  initial: { investigation: Investigation; steps: InvestigationStep[] },
) {
  const [investigation, setInvestigation] = useState(initial.investigation);
  const [steps, setSteps] = useState(initial.steps);

  useEffect(() => {
    if (isTerminal(investigation.status)) return;
    const supabase = createClient();

    async function reselect() {
      const fresh = await getInvestigation(supabase, id);
      if (fresh) {
        setInvestigation(fresh.investigation);
        setSteps(fresh.steps);
      }
    }

    const channel = supabase
      .channel(`investigation:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "investigation_steps", filter: `investigation_id=eq.${id}` },
        (payload) => setSteps((prev) => applyStepEvent(prev, payload.new as InvestigationStep)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "investigations", filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Investigation;
          setInvestigation((prev) => applyStatusEvent(prev, row));
          if (isTerminal(row.status)) {
            supabase.removeChannel(channel);
            void reselect();
          }
        },
      )
      .subscribe((status) => {
        // CHANNEL_ERROR / TIMED_OUT → degrade to a one-shot re-SELECT (spec §7.5).
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") void reselect();
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // Re-run only when the id or terminal-ness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, investigation.status]);

  return { investigation, steps };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/investigations-live.test.ts`
Expected: PASS (reducer + `isTerminal` tests; the hook is exercised in Task 9).


---

## Task 5: Database types + data-access layer

Lands the typed row shapes and the three RLS data-access functions (spec §4.1–4.2). This replaces `lib/api.ts`.

**Files:**
- Create: `apps/web/lib/database.types.ts`
- Create: `apps/web/lib/investigations.ts`
- Test: `apps/web/lib/__tests__/investigations.test.ts`

**Interfaces:**
- Produces types (mirroring the persisted jsonb, from `apps/api/src/app/graph/state.py`):
  - `Source = { id; url: string | null; kind: "search_result"|"fetched_page"|"whois"|"dns"|"user_provided"; retrieved_at: string; content_summary: string; raw_excerpt: string | null }`
  - `Finding = { id; category: "company"|"job"|"recruiter"|"domain"|"communication"|"cross_source"; direction: "legitimizing"|"suspicious"|"unverifiable"; severity: "info"|"low"|"medium"|"high"|"critical"; claim: string; source_ids: string[]; provenance: "web_verified"|"deterministic"|"user_provided_unverified"; mitigation: string | null }`
  - `FinalAssessment = { band: "LOW"|"MODERATE"|"HIGH"|"CRITICAL"; confidence: "LOW"|"MODERATE"|"HIGH"; summary: string; coverage: number }`
  - `Submission = { job_text: string; company_name?: string; recruiter_email?: string; job_url?: string }`
  - `Investigation = { id; user_id; status; submission: Submission; assessment: FinalAssessment | null; findings: Finding[] | null; sources: Source[] | null; cost: Record<string, unknown> | null; what_to_verify: string[] | null; check_count: number | null; created_at: string }`
  - `InvestigationStep = { investigation_id; step_key; label; display_order: number; status; started_at: string | null; finished_at: string | null }`
- Produces functions:
  - `createInvestigation(client, submission): Promise<{ id: string } | { error: string }>`
  - `getInvestigation(client, id): Promise<{ investigation: Investigation; steps: InvestigationStep[] } | null>`
  - `recentInvestigations(client, limit?): Promise<Investigation[]>`

- [ ] **Step 1: Author `database.types.ts`**

Create `apps/web/lib/database.types.ts`. Header comment first:

```ts
// Supabase table types — HAND-AUTHORED to match:
//   supabase/migrations/20260819073420_investigations_v1.sql
//   supabase/migrations/20260819080000_investigations_sources.sql
// OPERATOR: regenerate against the local stack and overwrite this file:
//   supabase gen types typescript --local > apps/web/lib/database.types.ts
// The jsonb payload shapes mirror apps/api/src/app/graph/state.py.

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      investigations: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          submission: Json;
          assessment: Json | null;
          findings: Json | null;
          sources: Json | null;
          cost: Json | null;
          what_to_verify: Json | null;
          check_count: number | null;
          created_at: string;
        };
        Insert: { submission: Json };
        Update: never;
      };
      investigation_steps: {
        Row: {
          investigation_id: string;
          step_key: string;
          label: string;
          display_order: number;
          status: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
```

- [ ] **Step 2: Write the failing data-access test (faked client)**

Create `apps/web/lib/__tests__/investigations.test.ts`. The fake mirrors the supabase-js query builder chain used by the implementation:

```ts
import { describe, it, expect, vi } from "vitest";
import { createInvestigation, getInvestigation, recentInvestigations } from "../investigations";

// Minimal chainable stub. Each terminal (`.single()`, awaited select) resolves
// with the queued script entry.
function fakeClient(script: Record<string, any>) {
  const calls: any[] = [];
  const builder = (table: string) => {
    const ctx: any = { table, filters: {}, _order: null, _limit: null };
    const chain: any = {
      insert: (v: any) => ((ctx.op = "insert"), (ctx.value = v), chain),
      select: (c?: string) => ((ctx.op ??= "select"), (ctx.columns = c), chain),
      eq: (col: string, val: any) => ((ctx.filters[col] = val), chain),
      order: (col: string, o: any) => ((ctx._order = [col, o]), chain),
      limit: (n: number) => ((ctx._limit = n), chain),
      single: () => (calls.push(ctx), Promise.resolve(script[`${table}:single`] ?? { data: null, error: null })),
      then: (res: any) => (calls.push(ctx), Promise.resolve(script[table] ?? { data: [], error: null }).then(res)),
    };
    return chain;
  };
  return { from: builder, _calls: calls } as any;
}

describe("createInvestigation", () => {
  it("inserts submission and returns the new id", async () => {
    const client = fakeClient({ "investigations:single": { data: { id: "new-id" }, error: null } });
    const r = await createInvestigation(client, { job_text: "x" });
    expect(r).toEqual({ id: "new-id" });
    const insert = client._calls.find((c: any) => c.op === "insert");
    expect(insert.value).toMatchObject({ submission: { job_text: "x" } });
  });
  it("returns an error message on constraint violation", async () => {
    const client = fakeClient({
      "investigations:single": { data: null, error: { message: "violates check constraint" } },
    });
    const r = await createInvestigation(client, { job_text: "" });
    expect(r).toHaveProperty("error");
  });
});

describe("getInvestigation", () => {
  // RLS boundary (backend spec §4): another user's row is invisible under
  // investigations_select_own, so the SELECT returns zero rows — never an
  // error. The client relies on this null to render not-found rather than
  // leaking existence. This test pins that contract on the web side; the DB
  // enforcement itself is proven by scripts/verify_rls.sql (operator-run).
  it("returns null when the row is absent or RLS-denied (0 rows, no error)", async () => {
    const client = fakeClient({ "investigations:single": { data: null, error: null } });
    expect(await getInvestigation(client, "missing")).toBeNull();
  });
  it("does not surface a row when RLS yields no data even if a benign error is set", async () => {
    const client = fakeClient({
      "investigations:single": { data: null, error: { code: "PGRST116", message: "0 rows" } },
    });
    expect(await getInvestigation(client, "someone-elses-id")).toBeNull();
  });
  it("returns the row and its steps when present", async () => {
    const client = fakeClient({
      "investigations:single": { data: { id: "i1", status: "done", submission: {} }, error: null },
      investigation_steps: { data: [{ step_key: "intake", display_order: 1 }], error: null },
    });
    const out = await getInvestigation(client, "i1");
    expect(out?.investigation.id).toBe("i1");
    expect(out?.steps).toHaveLength(1);
  });
});

describe("recentInvestigations", () => {
  it("orders by created_at desc and limits", async () => {
    const client = fakeClient({ investigations: { data: [{ id: "a" }, { id: "b" }], error: null } });
    const out = await recentInvestigations(client, 5);
    expect(out).toHaveLength(2);
    const q = client._calls.find((c: any) => c.op === "select");
    expect(q._order).toEqual(["created_at", { ascending: false }]);
    expect(q._limit).toBe(5);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/investigations.test.ts`
Expected: FAIL — cannot resolve `../investigations`.

- [ ] **Step 4: Implement the data-access layer**

Create `apps/web/lib/investigations.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { SubmissionInput } from "./validation";

export type Source = {
  id: string;
  url: string | null;
  kind: "search_result" | "fetched_page" | "whois" | "dns" | "user_provided";
  retrieved_at: string;
  content_summary: string;
  raw_excerpt: string | null;
};
export type Finding = {
  id: string;
  category: "company" | "job" | "recruiter" | "domain" | "communication" | "cross_source";
  direction: "legitimizing" | "suspicious" | "unverifiable";
  severity: "info" | "low" | "medium" | "high" | "critical";
  claim: string;
  source_ids: string[];
  provenance: "web_verified" | "deterministic" | "user_provided_unverified";
  mitigation: string | null;
};
export type FinalAssessment = {
  band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  confidence: "LOW" | "MODERATE" | "HIGH";
  summary: string;
  coverage: number;
};
export type Submission = {
  job_text: string;
  company_name?: string;
  recruiter_email?: string;
  job_url?: string;
};
export type Investigation = {
  id: string;
  user_id: string;
  status: string;
  submission: Submission;
  assessment: FinalAssessment | null;
  findings: Finding[] | null;
  sources: Source[] | null;
  cost: Record<string, unknown> | null;
  what_to_verify: string[] | null;
  check_count: number | null;
  created_at: string;
};
export type InvestigationStep = {
  investigation_id: string;
  step_key: string;
  label: string;
  display_order: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
};

type Client = SupabaseClient<Database>;

export async function createInvestigation(
  client: Client,
  submission: SubmissionInput,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await client
    .from("investigations")
    .insert({ submission })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not start the check." };
  return { id: (data as { id: string }).id };
}

export async function getInvestigation(
  client: Client,
  id: string,
): Promise<{ investigation: Investigation; steps: InvestigationStep[] } | null> {
  const { data: inv } = await client.from("investigations").select("*").eq("id", id).single();
  if (!inv) return null;
  const { data: steps } = await client
    .from("investigation_steps")
    .select("*")
    .eq("investigation_id", id)
    .order("display_order", { ascending: true });
  return {
    investigation: inv as unknown as Investigation,
    steps: (steps ?? []) as unknown as InvestigationStep[],
  };
}

export async function recentInvestigations(client: Client, limit = 5): Promise<Investigation[]> {
  const { data } = await client
    .from("investigations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as Investigation[];
}
```

- [ ] **Step 5: Run it, verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/investigations.test.ts`
Expected: PASS.


---

## Task 6: Auth — AuthForm rewrite, sign-in page, callback, header

Replaces fake local sign-in with real Supabase auth (spec §5.1): email/password + Google + email confirmation, plus session-driven header sign-in/out.

**Files:**
- Modify: `apps/web/components/auth/AuthForm.tsx`
- Modify: `apps/web/app/sign-in/page.tsx`
- Create: `apps/web/app/auth/callback/route.ts`
- Modify: `apps/web/components/site/SiteHeader.tsx`
- Test: `apps/web/components/auth/__tests__/AuthForm.test.tsx` (rewrite)
- Test: `apps/web/components/site/__tests__/SiteHeader.test.tsx` (update)

**Interfaces:**
- Consumes: `authSchema` (Task 3), `createClient` browser (Task 2).
- Produces: `AuthForm` calling Supabase directly (no `onSuccess` email/mode contract); on success it navigates. `/auth/callback` route handler. Header reads the live session.

- [ ] **Step 1: Write the failing AuthForm test**

Rewrite `apps/web/components/auth/__tests__/AuthForm.test.tsx`. Mock the browser client so no network is hit:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
const signUp = vi.fn().mockResolvedValue({ data: {}, error: null });
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp, signInWithOAuth } }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AuthForm } from "../AuthForm";

beforeEach(() => vi.clearAllMocks());

describe("AuthForm", () => {
  it("blocks submit and shows a message when password < 8 chars", async () => {
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("calls signInWithPassword with valid credentials", async () => {
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "12345678");
    await userEvent.click(screen.getByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@b.com", password: "12345678" });
  });

  it("shows the auth error message when Supabase rejects", async () => {
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: "Invalid login credentials" } });
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "12345678");
    await userEvent.click(screen.getByRole("button", { name: /sign in and run/i }));
    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
  });

  it("triggers Google OAuth from the Google button", async () => {
    render(<AuthForm />);
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/web && npx vitest run components/auth/__tests__/AuthForm.test.tsx`
Expected: FAIL — current `AuthForm` takes `onSuccess` and has no Google button / Supabase calls.

- [ ] **Step 3: Rewrite `AuthForm`**

Rewrite `apps/web/components/auth/AuthForm.tsx` using `react-hook-form` + `zodResolver(authSchema)`. Keep the existing markup/tokens (mode toggle, TextField, MicroLabel, "why we ask" copy) but:
- Remove the `onSuccess` prop; the form owns the Supabase calls and navigation.
- On valid submit: `signin` → `signInWithPassword`; `create` → `signUp` (with `options.emailRedirectTo = <origin>/auth/callback`). On `error`, render its `message` in the existing `role="alert"` panel. On success for signin → `router.push("/verify")` (draft-resume handled in Task 7 via the page); for create → show a "check your email to confirm" message.
- Add a **"Continue with Google"** button below the CTA calling `signInWithOAuth({ provider: "google", options: { redirectTo: <origin>/auth/callback } })`.
- Password stays in RHF field state only; never persisted (Global Constraint). Preserve the `autoComplete` attributes.

Show the concrete handler core:

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authSchema, type AuthInput } from "../../lib/validation";
import { createClient } from "../../lib/supabase/client";
// ...existing UI imports (TextField, Button, MicroLabel, Link)

type Mode = "signin" | "create";
const CTA: Record<Mode, string> = {
  signin: "SIGN IN AND RUN THE CHECK",
  create: "CREATE ACCOUNT AND RUN THE CHECK",
};

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [authError, setAuthError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<AuthInput>({
    resolver: zodResolver(authSchema),
  });

  async function onSubmit(values: AuthInput) {
    setAuthError(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword(values);
      if (error) return setAuthError(error.message);
      router.push("/verify");
    } else {
      const { error } = await supabase.auth.signUp({ ...values, options: { emailRedirectTo: redirectTo } });
      if (error) return setAuthError(error.message);
      setConfirmSent(true);
    }
  }

  async function onGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  // ...render: mode toggle, TextField(email, {...register("email")}), TextField(password),
  //    field errors from `errors`, authError alert, confirmSent notice,
  //    <Button type="submit">{CTA[mode]}</Button>, <Button type="button" onClick={onGoogle}>Continue with Google</Button>
}
```

> `TextField`/`TextArea` currently take `value`/`onChange`. If they don't forward refs / accept `register` props, wire them with `onChange={(v) => setValue(...)}` + `register`, or add a `name`+`onBlur` passthrough. Keep the change minimal and preserve `label`/`autoComplete`. Do not alter their styling.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/web && npx vitest run components/auth/__tests__/AuthForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update the sign-in page**

Modify `apps/web/app/sign-in/page.tsx`: drop the `onSuccess`/flow-`set` wiring; render `<AuthForm />` directly (it self-navigates). Keep the copy, `MicroLabel`, `QueuedCard`, and layout. Remove the now-unused `AuthMode` import.

- [ ] **Step 6: Add the OAuth/confirm callback route**

Create `apps/web/app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}/verify`);
}
```

- [ ] **Step 7: Update the header for real sessions + write its test**

Update `apps/web/components/site/SiteHeader.tsx`: instead of `useFlow().state.signedIn`, accept the session via props from a server parent OR read it in a small client effect using `createClient().auth.getUser()`. Simplest: keep it a client component, add `useEffect` to fetch the user once; when present show the email + a "Sign out" button (`signOut()` → `router.push("/")`), else the "Sign in" link. Update `components/site/__tests__/SiteHeader.test.tsx` to mock `../../lib/supabase/client` and assert: signed-out shows "Sign in"; signed-in shows sign-out control. Remove the `useFlow` dependency for auth state.

Run: `cd apps/web && npx vitest run components/site/__tests__/SiteHeader.test.tsx`
Expected: PASS.


---

## Task 7: `/verify` — new-check form + recent strip, trimmed flow-context, landing

Builds the authenticated home (spec §3): paste + details form that validates and INSERTs, a recent-checks strip, the trimmed draft-carry context, and the landing "Start" routing.

**Files:**
- Modify: `apps/web/lib/flow-context.tsx`
- Create: `apps/web/components/verify/NewCheckForm.tsx`
- Create: `apps/web/components/verify/RecentChecks.tsx`
- Create: `apps/web/app/verify/page.tsx`
- Modify: `apps/web/app/page.tsx` (landing "Start" → `/sign-in`, draft carried)
- Test: `apps/web/components/verify/__tests__/NewCheckForm.test.tsx`
- Test: `apps/web/components/verify/__tests__/RecentChecks.test.tsx`

**Interfaces:**
- Consumes: `submissionSchema` (Task 3), `createInvestigation`/`recentInvestigations`/`Investigation` (Task 5), `createClient` browser (Task 2), `useFlow` (trimmed).
- Produces: `/verify` page; `NewCheckForm` (validate → insert → `router.push('/investigations/'+id)`); `RecentChecks` list.

- [ ] **Step 1: Trim `flow-context`**

Modify `apps/web/lib/flow-context.tsx`: reduce `FlowState` to the pre-auth draft only — `{ jobInput, company, site, recruiter, email, convo }`. Remove `signedIn`, `authEmail`, `authMode`, `fetchError`, and the `submitted` derivation (moves to the view model, Task 8). Keep sessionStorage persistence of the survivable draft keys. Update `lib/__tests__/flow-context.test.tsx` to the trimmed shape (drop auth-field assertions).

Run: `cd apps/web && npx vitest run lib/__tests__/flow-context.test.tsx`
Expected: PASS.

- [ ] **Step 2: Write the failing NewCheckForm test**

Create `apps/web/components/verify/__tests__/NewCheckForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createInvestigation = vi.fn();
vi.mock("../../../lib/investigations", () => ({ createInvestigation: (...a: any) => createInvestigation(...a) }));
vi.mock("../../../lib/supabase/client", () => ({ createClient: () => ({}) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewCheckForm } from "../NewCheckForm";

beforeEach(() => vi.clearAllMocks());

describe("NewCheckForm", () => {
  it("blocks submit with an empty posting", async () => {
    render(<NewCheckForm initialJobText="" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(createInvestigation).not.toHaveBeenCalled();
    expect(screen.getByText(/paste the posting/i)).toBeInTheDocument();
  });

  it("inserts and navigates to the investigation on success", async () => {
    createInvestigation.mockResolvedValueOnce({ id: "abc" });
    render(<NewCheckForm initialJobText="Acme VA role, pay upfront" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(createInvestigation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ job_text: "Acme VA role, pay upfront" }),
    );
    expect(push).toHaveBeenCalledWith("/investigations/abc");
  });

  it("shows an insert error on the form", async () => {
    createInvestigation.mockResolvedValueOnce({ error: "violates check constraint" });
    render(<NewCheckForm initialJobText="x" />);
    await userEvent.click(screen.getByRole("button", { name: /run the check/i }));
    expect(await screen.findByText(/couldn.t start|check constraint/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd apps/web && npx vitest run components/verify/__tests__/NewCheckForm.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `NewCheckForm`**

Create `apps/web/components/verify/NewCheckForm.tsx` (client). Use `react-hook-form` + `zodResolver(submissionSchema)`, default `job_text` = `initialJobText`. Reuse `ScanField` (or `TextArea`) for the posting and `TextField` for `company_name`/`recruiter_email`/`job_url` — reuse the existing `DetailsForm` fields' look. On submit: `createInvestigation(createClient(), values)`; on `{id}` → `router.push('/investigations/'+id)`; on `{error}` → map to a form-level alert (friendly copy; raw message shown for constraint text). Provide a submit button labeled to match the test (`…RUN THE CHECK`).

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { submissionSchema, type SubmissionInput } from "../../lib/validation";
import { createInvestigation } from "../../lib/investigations";
import { createClient } from "../../lib/supabase/client";
// ...UI imports

export function NewCheckForm({ initialJobText }: { initialJobText: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SubmissionInput>({
    resolver: zodResolver(submissionSchema),
    defaultValues: { job_text: initialJobText },
  });

  async function onSubmit(values: SubmissionInput) {
    setFormError(null);
    const result = await createInvestigation(createClient(), values);
    if ("error" in result) return setFormError("We couldn’t start the check. " + result.error);
    router.push(`/investigations/${result.id}`);
  }
  // ...render fields with {...register(...)}, field errors, formError alert,
  //    <Button type="submit" disabled={isSubmitting}>RUN THE CHECK</Button>
}
```

- [ ] **Step 5: Run it, verify it passes**

Run: `cd apps/web && npx vitest run components/verify/__tests__/NewCheckForm.test.tsx`
Expected: PASS.

- [ ] **Step 6: RecentChecks — failing test then implement**

Create `apps/web/components/verify/__tests__/RecentChecks.test.tsx` asserting: given a list of `Investigation`, it renders one link per item to `/investigations/{id}`, newest first, each showing a status label and the submission's `company_name` or a fallback; an empty list renders a "no checks yet" line.

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentChecks } from "../RecentChecks";

const inv = (id: string, company: string, status: string) =>
  ({ id, status, submission: { job_text: "x", company_name: company }, created_at: "2026-08-19T00:00:00Z" }) as any;

describe("RecentChecks", () => {
  it("renders a link per investigation", () => {
    render(<RecentChecks items={[inv("a", "Acme", "done"), inv("b", "Globex", "running")]} />);
    expect(screen.getByRole("link", { name: /acme/i })).toHaveAttribute("href", "/investigations/a");
    expect(screen.getByRole("link", { name: /globex/i })).toHaveAttribute("href", "/investigations/b");
  });
  it("shows an empty state", () => {
    render(<RecentChecks items={[]} />);
    expect(screen.getByText(/no checks yet/i)).toBeInTheDocument();
  });
});
```

Run → FAIL. Then create `apps/web/components/verify/RecentChecks.tsx`: a client-free presentational list using `next/link`, existing tokens (mono labels, hairline rows), status text, and `submission.company_name ?? "Untitled posting"`. Run → PASS.

- [ ] **Step 7: `/verify` page (server) + landing routing**

Create `apps/web/app/verify/page.tsx` (server component): `const supabase = await createClient()`; `getUser()` (middleware already guards, but guard defensively); `const items = await recentInvestigations(supabase)`; read the draft prefill — since the draft lives in client `flow-context`/sessionStorage, pass `initialJobText=""` server-side and let `NewCheckForm` hydrate the draft from `useFlow()` on mount (add a small effect in `NewCheckForm` to seed `job_text` from flow state if `initialJobText` is empty). Render `SiteHeader`, the `NewCheckForm`, and `<RecentChecks items={items} />`.

Modify `apps/web/app/page.tsx`: the landing "Start" button writes the pasted draft to `useFlow().set({ jobInput })` and routes to `/sign-in` (middleware/`/verify` handles the authed case). Remove the `state.signedIn` branch (auth is no longer in flow state). Keep landing sections/UI intact.

- [ ] **Step 8: Full web suite for the touched areas**

Run: `cd apps/web && npx vitest run components/verify lib/__tests__/flow-context.test.tsx app/__tests__`
Expected: PASS. Fix any landing test that asserted the old `signedIn` routing.


---

## Task 8: Unified investigation view + report view-model refactor

Collapses running + report into one status-driven route (spec §3, §6) and refactors the view model onto the DB row shape (spec §4.4).

**Files:**
- Modify: `apps/web/lib/report-view-model.ts`
- Create: `apps/web/components/investigation/InvestigationView.tsx`
- Modify: `apps/web/app/investigations/[id]/page.tsx` (replace the redirect shim)
- Modify: report fixtures `apps/web/lib/__fixtures__/sample-low.ts`, `sample-high.ts`
- Test: `apps/web/lib/__tests__/report-view-model.test.ts` (update to row shape)
- Test: `apps/web/components/investigation/__tests__/InvestigationView.test.tsx`

**Interfaces:**
- Consumes: `Investigation`/`InvestigationStep` + `getInvestigation` (Task 5), `useInvestigationLive`/`isTerminal` (Task 4), existing report components (`BandBanner`, `ConfidencePanel`, `Summary`, `FindingGroup`, `VerifyChecklist`, `ReportFooter`, `ReportRail`) and progress components (`StepList`, `StepRow`, `EvidenceRail`).
- Produces: `toReportViewModel(inv: Investigation): ReportVM` (now sourcing `submitted` from `inv.submission`); `InvestigationView({ initial })`.

- [ ] **Step 1: Update the report-view-model test to the row shape**

Edit `apps/web/lib/__tests__/report-view-model.test.ts`: replace `Investigation` REST fixtures with the DB `Investigation` shape (from Task 5) — `submission` present, `sources` as an array on the row. Add a case asserting `submitted` rows are derived from `inv.submission` (company_name/recruiter_email), **not** a passed-in `Submitted` arg. Keep all band/confidence/defang/provenance assertions.

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/web && npx vitest run lib/__tests__/report-view-model.test.ts`
Expected: FAIL — `toReportViewModel` still imports `./api` and takes a `submitted` arg.

- [ ] **Step 3: Refactor `toReportViewModel`**

Modify `apps/web/lib/report-view-model.ts`:
- Replace `import type { Investigation } from "./api"` with `import type { Investigation, Source, Finding } from "./investigations"`.
- Change the signature to `toReportViewModel(inv: Investigation): ReportVM`.
- Build the source map from `inv.sources ?? []`; findings from `inv.findings ?? []`; `what_to_verify` from `inv.what_to_verify ?? []`.
- Derive `submitted` from `inv.submission`: `company → Company`, `recruiter_email → Email (mono)`. (Job title / recruiter name / contact channel remain unmapped as before — no source field.)
- Keep `BAND_MEANING`, `CONFIDENCE_*`, defang, group ordering, `repeatLine` from `inv.check_count`, `caseId` unchanged.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd apps/web && npx vitest run lib/__tests__/report-view-model.test.ts`
Expected: PASS. Also update `lib/__fixtures__/sample-low.ts`/`sample-high.ts` to the DB row shape (add `submission`, `user_id`, `created_at`, `sources` on the row) so the fixtures test and any report page test compile.

- [ ] **Step 5: Write the failing InvestigationView test**

Create `apps/web/components/investigation/__tests__/InvestigationView.test.tsx`. Mock `useInvestigationLive` to return controlled `{investigation, steps}`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const live = vi.fn();
vi.mock("../../../lib/investigations-live", async (orig) => ({
  ...(await orig<any>()),
  useInvestigationLive: (_id: string, initial: any) => live(initial),
}));
import { InvestigationView } from "../InvestigationView";
import { SAMPLE_HIGH } from "../../../lib/__fixtures__/sample-high";

function setLive(investigation: any, steps: any[]) {
  live.mockReturnValue({ investigation, steps });
}

describe("InvestigationView", () => {
  it("renders the checklist while running", () => {
    setLive({ ...SAMPLE_HIGH.inv, status: "running" }, [
      { investigation_id: "i", step_key: "intake", label: "Reading the posting", display_order: 1, status: "done", started_at: null, finished_at: null },
      { investigation_id: "i", step_key: "report", label: "Writing the report", display_order: 6, status: "running", started_at: null, finished_at: null },
    ]);
    render(<InvestigationView initial={{ investigation: { ...SAMPLE_HIGH.inv, status: "running" }, steps: [] }} />);
    expect(screen.getByText(/reading the posting/i)).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_HIGH.inv.assessment!.summary)).not.toBeInTheDocument();
  });

  it("renders the report when done", () => {
    setLive({ ...SAMPLE_HIGH.inv, status: "done" }, []);
    render(<InvestigationView initial={{ investigation: { ...SAMPLE_HIGH.inv, status: "done" }, steps: [] }} />);
    expect(screen.getByText(SAMPLE_HIGH.inv.assessment!.summary)).toBeInTheDocument();
  });

  it("renders an error panel when failed", () => {
    setLive({ ...SAMPLE_HIGH.inv, status: "failed" }, []);
    render(<InvestigationView initial={{ investigation: { ...SAMPLE_HIGH.inv, status: "failed" }, steps: [] }} />);
    expect(screen.getByText(/couldn.t finish|something went wrong|run it again/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `cd apps/web && npx vitest run components/investigation/__tests__/InvestigationView.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 7: Implement `InvestigationView` + the route**

Create `apps/web/components/investigation/InvestigationView.tsx` (client):

```tsx
"use client";
import { useInvestigationLive } from "../../lib/investigations-live";
import { toReportViewModel } from "../../lib/report-view-model";
import type { Investigation, InvestigationStep } from "../../lib/investigations";
// report + progress component imports

export function InvestigationView({
  initial,
}: {
  initial: { investigation: Investigation; steps: InvestigationStep[] };
}) {
  const { investigation, steps } = useInvestigationLive(initial.investigation.id, initial);
  const status = investigation.status;

  if (status === "queued" || status === "running") {
    return <Checklist steps={steps} />; // StepList driven by real rows (label/status/display_order)
  }
  if (status === "failed") {
    return <FailedPanel id={investigation.id} />; // concise; worker internals never shown (spec §8)
  }
  // done | deadline_exceeded → report
  const vm = toReportViewModel(investigation);
  return <Report vm={vm} />; // existing BandBanner/ConfidencePanel/Summary/FindingGroup/VerifyChecklist/Footer
}
```

Implement the `Checklist`, `FailedPanel`, and `Report` subcomponents inline (or small files) by composing the **existing** components; drive `StepList`/`StepRow` from the real step rows (map `status` → the row's visual state) instead of `progress-script.ts`. For a not-found case the page (Step 8) handles `null` before rendering this.

Modify `apps/web/app/investigations/[id]/page.tsx` (replace the redirect shim) — server component, SELECT-first:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { getInvestigation } from "../../../lib/investigations";
import { InvestigationView } from "../../../components/investigation/InvestigationView";
import { SiteHeader } from "../../../components/site/SiteHeader";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const initial = await getInvestigation(supabase, id);
  if (!initial) notFound(); // RLS/no row → 404 (reuses Next's not-found)
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <InvestigationView initial={initial} />
      </main>
    </>
  );
}
```

Add `apps/web/app/investigations/[id]/not-found.tsx` (or a top-level `app/not-found.tsx`) rendering the existing NOT FOUND panel copy.

- [ ] **Step 8: Run the view + full suite**

Run: `cd apps/web && npx vitest run components/investigation lib/__tests__/report-view-model.test.ts`
Expected: PASS.


---

## Task 9: V0 teardown + full green + type-check

Deletes the V0 web data layer (spec §8), proving nothing imports it, and lands a clean full-suite + type-check. This is what unblocks the backend teardown to ride this branch.

**Files:**
- Delete: `apps/web/lib/ownerKey.ts`, `apps/web/lib/api.ts`, `apps/web/lib/__tests__/ownerKey.test.ts`, `apps/web/lib/__tests__/api.test.ts`
- Delete: `apps/web/app/check/`, `apps/web/app/report/`, `apps/web/components/progress/progress-script.ts`
- Delete: obsolete tests referencing deleted routes (`app/check/__tests__/running.test.tsx`, `app/report/__tests__/page.test.tsx`)
- Modify: any remaining importers surfaced by grep/tsc

- [ ] **Step 1: Delete the V0 data layer + dead routes**

```bash
cd apps/web
git rm lib/ownerKey.ts lib/api.ts lib/__tests__/ownerKey.test.ts lib/__tests__/api.test.ts
git rm -r app/check app/report
git rm components/progress/progress-script.ts
git rm app/check/__tests__/running.test.tsx app/report/__tests__/page.test.tsx 2>/dev/null || true
```

- [ ] **Step 2: Prove nothing live still imports the deleted modules**

Run: `cd apps/web && git grep -nE "lib/api\"|ownerKey|@job-hunt/api-types|progress-script|/check/running|/report/" -- 'app' 'components' 'lib' || echo "clean"`
Expected: `clean` (or only comments/docs). Fix any straggler import surfaced (e.g. an `EvidenceRail`/`StepList` that imported `progress-script` must now take real step data as props).

- [ ] **Step 3: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors. Resolve any `@job-hunt/api-types` or `./api` residue.

- [ ] **Step 4: Full web suite**

Run: `cd apps/web && npm test`
Expected: PASS across the suite (validation, investigations, live reducers, AuthForm, SiteHeader, NewCheckForm, RecentChecks, InvestigationView, report-view-model, product-rules guardrails, landing/mobile/a11y). Fix any remaining fixture/shape drift.


- [ ] **Step 5: Handoff note (no code)**

In the PR/branch description, note for the operator (per backend spec §7.7 / memory `v1-backend-teardown-deferred`): this branch removes the web `@job-hunt/api-types` import, so the **backend teardown (backend plan Task 6)** — deleting `packages/api-types`, `scripts/gen-types.mjs`, `apps/api/scripts/dump_openapi.py`, `main.py` routes, `docker-compose.yml`, and pruning `db.py` — can now merge on the same branch to `main`. Also: apply the three migrations (`…investigations_v1`, `…langgraph_checkpointer`, `…investigations_sources`) and regenerate `apps/web/lib/database.types.ts` via `supabase gen types typescript --local`.

---

## Self-Review

**Spec coverage:**
- §2 decisions (SSR clients, providers, realtime, no-zustand, /verify, recent-only, no-mock, teardown, hand-typed) → Tasks 2–9. ✅
- §3 routing/flow (landing → sign-in → /verify → /investigations/[id]; middleware guard; deleted routes) → Tasks 3, 6, 7, 8, 9. ✅
- §4.1 clients (browser/server/middleware/types) → Tasks 2, 5. ✅
- §4.2 data access (create/get/recent, null on empty) → Task 5. ✅
- §4.3 realtime (pure reducers + lifecycle hook, degrade on error) → Task 4. ✅
- §4.4 view model on row shape + submitted from submission; sources gap resolved by column → Tasks 1, 8. ✅
- §5.1 auth (email/password + confirm + Google + callback + sign-out) → Task 6. ✅
- §5.2 validation (submission mirrors DB CHECK; auth) → Task 3. ✅
- §5.3 flow-context trim → Task 7. ✅
- §6 status→view + errors (checklist/report/failed/not-found; insert error on form; auth errors) → Tasks 5, 6, 7, 8. ✅
- §7 testing (pure/data/components; mock at boundary; no live DB; kept guardrails) → every task's test steps. ✅
- §8 deletions → Task 9. ✅
- §9 deps/env → Task 2. ✅

**Placeholder scan:** No TBD/TODO. Each code step carries concrete code or an exact, bounded instruction (e.g. the `TextField` ref-forwarding note names the fallback wiring). The `AuthForm`/`NewCheckForm` render bodies are shown as their handler cores with an explicit list of the remaining JSX to compose from named existing components — not deferred logic.

**Type consistency:** `Investigation`/`InvestigationStep`/`Source`/`Finding`/`FinalAssessment`/`Submission` are defined once in Task 5 and imported everywhere after; `applyStepEvent`/`applyStatusEvent`/`isTerminal`/`useInvestigationLive` signatures match between Task 4 and Task 8; `createInvestigation`/`getInvestigation`/`recentInvestigations` signatures match between Task 5 and Tasks 7–8; `submissionSchema`/`authSchema` from Task 3 used in Tasks 6–7; `toReportViewModel(inv)` new one-arg signature consistent between Task 8's refactor and its consumer.

**Ordering note:** Task 4 references types authored in Task 5 Step 1. Executors running strictly in order should author `apps/web/lib/investigations.ts` (Task 5) before Task 4, or accept a transient unresolved-type until Task 5; the interface blocks list the exact shapes so either order compiles once both land. Flagged in Task 4's Interfaces.

---

## Execution Handoff

Two verification points the executor resolves against installed versions (neither blocks planning): the exact `@supabase/ssr` cookie method names for the installed major (`getAll`/`setAll` shown; older `get`/`set`/`remove` differs) and the Realtime `postgres_changes` filter payload shape. Both are flagged inline. Everything else is fully specified.
