# Admin Console Design

**Goal:** Give the operator a single `/admin` page that both answers "how is this thing doing?" at a glance **and** lets them work the feedback queue — all on one surface. The top of the page is an at-a-glance **Overview**: how many people have signed up, how many checks have run, how much feedback has come in (and of what kind), and where the feedback→dataset pipeline stands. Below it is the **Feedback triage** queue (the promote-to-dataset flow that until now lived at its own `/admin/feedback` URL). This spec makes `/admin` the one operator console: the stats grid and the triage queue become two sections of the same page, and `/admin/feedback` folds in (it now redirects to `/admin`).

**Roadmap position:** A small operability follow-on to the feedback→eval loop (`docs/superpowers/specs/2026-08-26-feedback-eval-loop-design.md`). It surfaces, as headline numbers, the tables that loop already created (`feedback`, `eval_candidate`) plus the existing `investigations` table and the auth user count, and it rehomes that loop's triage UI onto the same page. It adds no new product surface and weakens no guardrail — the one write path (promote) is the loop's existing action, relocated, not a new one.

**Architecture:** The console is a server component that reads counts through the **same server-only privileged client** the triage queue already uses (`supabaseAdmin`, backed by the least-privilege `admin_ro` role). Every metric but one is a direct read of a table `admin_ro` is already granted: `investigations`, `feedback`, `eval_candidate`. The single exception is the registered-user count, which lives in `auth.users` — a schema `admin_ro` cannot read. Rather than grant the role broad access to user rows, we add one scoped `SECURITY DEFINER` function that returns **only** `count(*)` as an integer, and grant `execute` on it to `admin_ro`. So the page exposes a single number from the auth schema and never a user row. The triage half keeps exactly the reads and the promote server action it has today; consolidation is a **move**, not a rewrite.

Two properties define the design:

1. **One surface, no new mutation.** Overview + triage live on one page. The only write is the **existing** `promote` server action, relocated from `/admin/feedback` and unchanged in behavior (still one `eval_candidate` INSERT via `admin_ro`'s existing grant). The stats themselves are read-only; no new mutation path is introduced by this spec.
2. **Least-privilege, minimally widened.** `admin_ro` gains exactly two capabilities, both read-only: `execute` on the scalar-count function (the tightest way to surface the auth-schema number it otherwise couldn't see), and `SELECT` on `public.eval_candidate` (so the Overview can tally candidate statuses). `eval_candidate` holds only the operator-authored dataset cases the role already writes; the grant adds no user-PII reach beyond `investigations`/`feedback`, which `admin_ro` already reads. No delete/update, no other new table.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / vitest (apps/web), Postgres + Supabase migration (`SECURITY DEFINER` function), Python 3.12 / pytest (apps/api migration text-assertion test), Cloudflare Access (admin edge auth, unchanged from the feedback-loop spec).

**Spec references:** `docs/superpowers/specs/2026-08-26-feedback-eval-loop-design.md` (the `admin_ro` role, the server-only `supabaseAdmin` client, the CF Access edge guard, the promote action, and the 404-not-403 convention this page reuses verbatim). Prior art / the surface being folded in: `apps/web/app/admin/feedback/page.tsx` and `apps/web/app/admin/feedback/actions.ts` (server component, `assertAdmin`, `loadTriage`/`toTriageRows` shapers, the `promote` action). Prior art for the migration test: `apps/api/tests/migrations/`. **Design source of truth:** `apps/web/app/globals.css` (`@theme` tokens — the authoritative handoff); the visual treatment in § Visual Design & Interaction was worked through with the `ui-ux-pro-max` and `emil-design-eng` skills, applied only where the handoff is silent.

## Global Constraints

- **One page, no *new* mutation.** The Overview stats issue `SELECT`/`rpc` reads only. The single write path is the **existing** `promote` server action, moved from `app/admin/feedback/actions.ts` to `app/admin/actions.ts` with its logic byte-for-byte unchanged (one `eval_candidate` INSERT). This spec introduces no additional `INSERT`/`UPDATE`/`DELETE`.
- **Least-privilege is minimally widened, read-only.** `admin_ro` keeps its existing grants (`SELECT` on `investigations`, `feedback`; `INSERT` on `eval_candidate`) and gains exactly two read capabilities: `execute` on `public.admin_registered_user_count()`, and `SELECT` on `public.eval_candidate` (for the status tally). The role is still **not** granted `SELECT` on `auth.users` (only the aggregate integer leaves that schema), and gains no delete/update and no other new table.
- **The `SECURITY DEFINER` function is hardened like the loop's triggers.** It is declared `security definer`, `stable`, with `set search_path = ''` (fully-qualified `auth.users` inside), and `execute` is `revoke`d from `public` before being granted to `admin_ro`. This mirrors the server-force triggers in the feedback migration.
- **Edge auth and no-leak convention are reused, not re-invented.** `/admin` validates admin identity through the same `assertAdmin(headers)` the triage page used; an unauthorized request returns **404, not 403**. No new auth logic. The `/admin/feedback` redirect stub carries no data and needs no auth of its own (it only forwards to `/admin`, which is guarded).
- **All-time totals only.** Every Overview figure is a lifetime count. No time-windowing (no "last 7 days") in this version — deliberately scoped out to keep each query a single unfiltered count.
- **The service_role key never reaches the browser.** Unchanged: all `/admin` data access is server-only; `supabaseAdmin` is imported only from server components; its key comes from a non-`NEXT_PUBLIC_` env var.
- **Migrations are operator-applied; their tests are text assertions**, not executed SQL — follow `apps/api/tests/migrations/`.
- Test commands: web `cd apps/web && pnpm vitest run <path>`; API migration test `cd apps/api && uv run pytest <path> -v`.
- Per project convention, the commit step is omitted from this spec.

## Metrics

All Overview figures are lifetime totals, read through `admin_ro`.

| Metric | Source | Read |
| --- | --- | --- |
| **Registered users** | `auth.users` | `rpc('admin_registered_user_count')` → integer |
| **Investigations** | `public.investigations` | `select` with `head: true`, `count: 'exact'` |
| **Feedback — total + by verdict** | `public.feedback` | derived from the verdict column of the rows `loadTriage` already fetches (no extra query) |
| **Eval candidates — total + by status** | `public.eval_candidate` | `select('status')`, tally in shaper |

Enum values the shaper groups by:

- `feedback.verdict` ∈ `agree`, `too_high`, `too_low`
- `eval_candidate.status` ∈ `promoted`, `exported`

**Query note:** Because triage already loads every `feedback` row (with its `verdict`), the by-verdict tally is computed from those in-memory rows rather than a second `select('verdict')` — one fewer round trip, and the grouping stays in the pure shaper (unit-testable without a database). The `eval_candidate` status tally still needs its own one-column select. If either table grows large enough that fetching one column per row is wasteful, switch those tallies to per-group `head: true` counts — a **documented future tradeoff, not built now** (YAGNI).

## Data Flow

```
GET /admin  (operator, behind CF Access)
  └─ assertAdmin(headers)                         → AdminAccessError ⇒ notFound() (404)
  └─ reads via supabaseAdmin (admin_ro):
       • loadTriage(supabaseAdmin)                → { feedback rows (+verdict), joined investigations } ⇒ TriageRow[]
       • eval_candidate  select('status')         → string[]
       • investigations  count (head:true)        → number
       • rpc('admin_registered_user_count')       → number
  └─ toDashboardStats({ …, feedbackVerdicts: rows.map(r => r.feedback.verdict), … })  → stats view model
  └─ render:
       <section id="overview">  stat cards (read-only)
       <section id="feedback">  <FeedbackTriage rows={…}>   — each row carries the Promote form

POST  promote (server action, relocated)          → admin_ro INSERT eval_candidate   (unchanged behavior)

GET /admin/feedback                                → redirect(308) → /admin
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

-- Overview also tallies eval_candidate by status; admin_ro has INSERT but not
-- SELECT on it (20260826130000). Add the read. Guarded so the migration is
-- safe to apply before/independent of the eval_candidate table's own migration.
do $$
begin
  if to_regclass('public.eval_candidate') is not null then
    execute 'grant select on public.eval_candidate to admin_ro';
  end if;
end $$;
```

Rationale: `admin_ro` cannot read `auth.users` and we do not want it to. A `SECURITY DEFINER` function runs with the definer's rights and returns only the scalar, so the role gains the count without gaining row access. `search_path = ''` + fully-qualified `auth.users` prevents search-path hijacking, exactly as the feedback migration's triggers do. The `eval_candidate` SELECT grant is the one table-grant addition (operator asked for the simplest read over a scoped counter function); it is read-only and over a table holding only operator-authored dataset cases.

### 2. Pure shapers — `toDashboardStats(raw)` (+ the relocated `toTriageRows`)

Top-level exports (mirroring today's `toTriageRows`), so grouping is tested without rendering a server component.

- `toDashboardStats`:
  - **Input:** `{ registeredUsers: number; investigationsTotal: number; feedbackVerdicts: string[]; candidateStatuses: string[] }` — note `feedbackVerdicts` is supplied by the caller from the already-loaded triage rows.
  - **Output:** a view model with the four headline totals plus grouped tallies:
    - `feedback: { total, agree, too_high, too_low }`
    - `candidates: { total, promoted, exported }`
    - `registeredUsers`, `investigationsTotal`
  - Unknown/unexpected enum strings are ignored (defensive), so a future enum value cannot crash the page.
- `toTriageRows` / `loadTriage`: unchanged logic, relocated alongside the extracted `FeedbackTriage` component (§3) so they no longer live under the retired `feedback/` route.

### 3. Triage component + relocated action — `FeedbackTriage` + `app/admin/actions.ts`

Extract the current `/admin/feedback` render body into a **`FeedbackTriage`** server component (colocated under `app/admin/`, e.g. `app/admin/FeedbackTriage.tsx`), taking the loaded `TriageResult` as a prop and rendering the queue exactly as today — the read-failure banner, the empty state, and each row's Promote form. The `promote` server action moves from `app/admin/feedback/actions.ts` to **`app/admin/actions.ts`** (one clean home now that there's no `feedback/` route); its body is unchanged. This keeps ONE version of the triage UI and its action — the console imports the component instead of duplicating markup.

### 4. Page — `apps/web/app/admin/page.tsx` (the console)

Server component:

1. `await assertAdmin(await headers())`; catch `AdminAccessError → notFound()` (404, never 403), identical to the retired triage page.
2. Load in parallel via `supabaseAdmin`: `loadTriage(...)`, the `eval_candidate` status select, the `investigations` head-count, and `rpc('admin_registered_user_count')`.
3. `toDashboardStats(...)`, passing the verdicts from the triage rows.
4. Render two sections: `#overview` (the stat-card grid) then `#feedback` (`<FeedbackTriage>` with the loaded result).

**UI:** an Overview stat-card grid above the full Feedback triage queue, on one page. Overview cards: **Registered users**, **Investigations**, **Feedback** (total + the three verdict sub-counts), **Eval candidates** (total + promoted/exported). The triage section is the existing queue with its per-row Promote form. The full visual, interaction, motion, and accessibility treatment — grounded in the authoritative design handoff and the design skills used to spec it — is in **§ Visual Design & Interaction** below.

### 5. Admin layout + top bar — `AdminHeader` + `app/admin/layout.tsx`

A minimal **server component** `AdminHeader` (no `"use client"`, no Supabase client, no CTA) and an `app/admin/layout.tsx` that renders it above `{children}`. With the console consolidated to one page, the bar is identity + light in-page navigation, not a set of route tabs:

- Reuses `SiteHeader`'s shell tokens (sticky, `border-b border-rule`, `h-[66px]`, `max-w-page`, `bg-ink` wordmark square) and its skip-to-content link — but strips the landing anchors, the account menu, and the "Check a job" CTA.
- Left: the `bg-ink` square + wordmark, suffixed "Admin" (`font-mono text-[11px] text-muted`) so it's unmistakably the operator surface.
- Right: two **in-page anchor links** — **Overview** (`#overview`) and **Feedback** (`#feedback`) — so the operator can jump straight to the (potentially long) queue. They use the header's existing `text-secondary hover:text-ink` treatment and ride the global smooth-scroll. No route tabs, no active-tab machinery (it's one page), no auth check of its own (the edge is the guard).

### 6. Redirect stub — `apps/web/app/admin/feedback/page.tsx`

Replace the old triage page with a one-line permanent redirect to the console: `redirect('/admin')` (Next's `redirect()` from `next/navigation`, which issues a 308). Old bookmarks and any in-product links to `/admin/feedback` resolve to the consolidated page instead of 404-ing. No data access, no `assertAdmin` needed here (the target is guarded).

## Visual Design & Interaction

The console inherits the app's design system verbatim — it introduces **no new visual language**. The handoff tokens in `app/globals.css` (`@theme`) are authoritative; the design skills below (`ui-ux-pro-max`, `emil-design-eng`) are applied only where the handoff is silent (semantics, data formatting, interaction states, motion, a11y), never to override a token. The reference surface is today's triage page, whose flat, hairline-ruled, mono-numeral treatment the Overview matches so the two sections read as one system.

**Design language (from the handoff, restated so implementation can't drift):**

- Flat datasheet aesthetic: `border-radius: 0` everywhere, hairline rules (`border-rule-soft` / `rule`), **no shadows** on stat cards (the `--shadow-band` token is reserved for the four risk-band cards and must not appear here), no gradients, no imagery, one accent family.
- Type: Helvetica/Arial body (`font-sans`), JetBrains Mono (`font-mono`) for every figure and metadata label — the "datasheet" feel comes from mono numerals.
- Focus ring, smooth-scroll, and easing curves (`--ease-out`, `--ease-in-out`) are already global; reuse them, don't redefine.

### Layout — top bar, then two stacked sections (no sidebar)

The admin surface is a **top-bar layout**: a single sticky bar across the top, then the page content beneath it, full-width to the page column. **No sidebar, no drawer, no tabs** — it's one scrolling page with two sections, so a sidebar would be empty ceremony and route-tabs would be dishonest (`ui-ux-pro-max` nav-hierarchy, `adaptive-navigation`). It also matches the rest of the app, which is top-bar-only (`components/site/SiteHeader.tsx`).

**Admin top bar** — the minimal `AdminHeader` (Components §5): wordmark + "Admin" on the left; two in-page anchor links (**Overview**, **Feedback**) on the right; same shell as `SiteHeader` (`sticky top-0 z-40 border-b border-rule bg-page` wrapping `mx-auto flex h-[66px] max-w-page items-center px-8 max-[430px]:px-5`) with the same skip-to-content first tab stop.

**Content region** — a single `<main id="main-content" className="mx-auto max-w-page px-8 py-16 max-[430px]:px-5">` (the skip-link target; horizontal padding matches the bar so content lines up under it), holding two `<section>`s:

**§ Overview** — opens with `<h2 id="overview" className="text-lg font-semibold">Overview</h2>` and a muted mono sub-line ("All-time totals"), then the card grid:

- **Hairline grid, not gapped cards.** Render the grid as `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-rule-soft`, with each card `bg-page p-6`. The `gap-px` over a rule-colored background paints continuous 1px seams between cards — the datasheet grid — instead of detached floating boxes. Wrap it in an outer `border border-rule-soft` so the block is fully ruled. A shadowed/rounded card grid would break fidelity.
- **No layout shift** (`ui-ux-pro-max` §3, Vercel CWV): the grid structure and card count are fixed and server-rendered, so there is nothing to reserve — but give each card a `min-h-*` so a `0`/`—` card and a 5-figure card are the same height. Verify no horizontal scroll at 375px (single column there).

**§ Feedback triage** — a `<section>` with `<h2 id="feedback" className="text-lg font-semibold">Feedback</h2>`, separated from Overview by generous vertical rhythm (e.g. `mt-16`) and a hairline `border-t border-rule-soft` so the eye reads two distinct zones on one page (`ui-ux-pro-max` whitespace-balance / section spacing). Below the heading, `<FeedbackTriage>` renders the existing queue markup unchanged: the read-failure banner, the "No feedback yet." empty state, and each `border border-rule-soft p-4` row with its Promote form.

### Card anatomy (semantic + formatting)

Each Overview card is a **definition pair**, not a generic div — a metric is a term (`<dt>`, the label) described by a value (`<dd>`, the number). Model the grid as a single `<dl>`; correct semantics, and it gives screen readers a coherent "label: value" reading (`ui-ux-pro-max` heading-hierarchy / screen-reader-summary) without any ARIA.

```
┌────────────────────────────┐
│ REGISTERED USERS      (dt)  │  ← text-[11px] uppercase tracking-wide text-muted font-mono
│                             │
│ 1,284                 (dd)  │  ← text-[40px] leading-none font-mono tabular-nums text-ink
└────────────────────────────┘
```

- **Numerals:** `font-mono` + `tabular-nums` (`font-variant-numeric: tabular-nums`) so digits are fixed-width and don't reflow (`ui-ux-pro-max` number-tabular). Format with `toLocaleString()` for thousands separators (`number-formatting`).
- **Headline number** in `text-ink` (near-black, high contrast); **labels** in `text-muted` (#666 ≈ 5.7:1 on white — clears AA 4.5:1). Do **not** drop labels to `text-faint` (#888 ≈ 3.5:1) — it fails AA for this small text (`ux` color-contrast).
- **Sub-counts** (Feedback verdicts, Eval-candidate statuses): a small mono breakdown beneath the headline as nested `dt`/`dd` or a `text-[12px]` mono row list — e.g. `agree 42 · too_high 11 · too_low 6`. Keep them **monochrome** (label `text-muted`, figure `text-ink`). Deliberately do **not** color verdicts with the band palette: those tokens (`band-low/moderate/high/critical`) carry risk-band meaning elsewhere, and reusing them would imply a semantic that doesn't exist and violate the one-accent-family rule. Meaning is carried by the text label, never color alone (`ux` color-not-only).

### Interaction & motion

Apply Emil's first question — *how often is this seen?* A single operator opens this page **occasionally**. The Overview is functional data; the triage queue is where the operator acts.

- **Overview: near-motionless.** No count-up / odometer animation on the numbers — animating a functional metric just delays the operator reading the real value; render final values immediately. If any entrance is wanted, a one-shot CSS card fade is the ceiling — `opacity 0→1` + `translateY(4px)→0`, `--ease-out`, ~180ms, 40ms stagger — implemented in CSS (`@starting-style` or a keyframe, off the main thread, matching the existing `rail-*` keyframes), and under `prefers-reduced-motion: reduce` the transform drops and only the fade remains. Shipping **no** entrance animation is equally correct; do not add more than this. Stat cards are read-only, so they carry no hover/press state — adding one would falsely signal clickability (`ux` affordance honesty).
- **Triage: the Promote button gets real press feedback.** It's the one repeated action on the page, so it must feel responsive: `transition: transform 160ms var(--ease-out)` with `active:scale-[0.97]` (`emil` — buttons must feel pressed), and a disabled/`aria-busy` state during the server-action submit so a double-click can't double-promote (`ux` loading-buttons / submit-feedback). This matches how `SiteHeader`'s buttons already behave; keep it consistent, don't invent a new interaction.
- **Top-bar anchor links** (Overview / Feedback) use the global focus ring and the header's `text-secondary → text-ink` hover, and ride the global smooth-scroll (which already yields to `prefers-reduced-motion`). Text links, so no `scale(0.97)` press state (that's for buttons).

### Accessibility checklist (page-specific)

- One `<h1>`-level page identity is the wordmark context; the two sections use `<h2>` (`#overview`, `#feedback`) with no level skips. Overview metric labels are `<dt>`. Reading order matches visual order.
- Every foreground/background pair ≥ 4.5:1 (numbers near-black on white; labels `text-muted`, not `text-faint`).
- No information conveyed by color alone — verdict/status sub-counts and Promote controls are labeled text.
- Motion respects `prefers-reduced-motion`; nothing auto-plays on a loop. The Promote form surfaces success/error and doesn't steal focus abruptly.
- Single-column reflow at 375px with no horizontal scroll; the anchor links and the triage forms remain operable; nothing fixed overlaps content.

### Vercel / Next.js best practices

- **Server Component data reads** — all counts and the triage load run server-side via `supabaseAdmin`; the `service_role`-backed client never ships to the browser. App-Router-recommended: fetch on the server, render markup. Run the four reads concurrently (`Promise.all`) so the queue load and the counts overlap.
- **Dynamic, never statically cached** — the page reads live data per request and already calls `headers()` (via `assertAdmin`), opting it into dynamic rendering, so figures and the queue are never served stale from a build-time cache. No `revalidate` tuning needed at this volume.
- **Streaming is optional** — Vercel's dashboard guidance favors wrapping slow reads in `<Suspense>` so the shell paints instantly. Here Overview is four light counts and triage is the same query it always was; a plain concurrent `await` is fine. If the queue read is ever slow, the upgrade path is a `<Suspense>` boundary around `<FeedbackTriage>` (Overview paints first, queue streams in) with a hairline skeleton at the same dimensions → no CLS. Documented future option, not built now (YAGNI).
- **`/admin` stays out of indexes** — inherited from the existing robots/CF-Access setup; consolidation adds no new public surface, and `/admin/feedback` now 308s in.

## Error Handling

- **Auth failure** → `notFound()` (404). No existence leak.
- **A failed or null Overview query** coalesces to `0` for that metric (Supabase returns `{ data: null }` on error; the shaper treats null/absent as empty). One broken read shows a `0` card; it never throws and never blanks the page.
- **RPC absent** (migration not yet applied) surfaces as a `0`/`—` registered-users card, not a crash. The rest of Overview and the triage queue still render.
- **Triage read failure** keeps its existing behavior: `loadTriage` returns `{ ok: false, error }` and `FeedbackTriage` shows the read-failed banner (a failed read is kept visually distinct from an empty queue), independent of whether the Overview reads succeeded.

## Testing

- **`apps/web/app/admin/__tests__/page.test.ts`** — mock `supabaseAdmin` via the established `vi.mock('.../lib/supabase/admin', () => ({ supabaseAdmin: {} }))` pattern (the module constructs a client at load and must be stubbed under vitest). Cover:
  - `toDashboardStats` groups verdicts and statuses correctly, including an unknown enum value being ignored and empty arrays → all-zero tallies, and that the verdict tally is computed from the supplied triage-row verdicts (no separate feedback query).
  - The page renders the Overview headline numbers and verdict/status sub-counts **and** the triage queue rows below them. Assert on rendered **text/roles** (the `<dl>`/`<dt>`/`<dd>` structure, the formatted figures, the Promote controls), never on Tailwind class names — per project convention, styling is not asserted.
  - Non-admin request path (`assertAdmin` throwing `AdminAccessError`) triggers `notFound()`.
- **`apps/web/app/admin/__tests__/*` for the relocated triage** — the existing `toTriageRows`/`loadTriage`/promote tests move with the code (paths updated); their assertions are unchanged, proving the relocation preserved behavior.
- **Redirect stub** — a small test asserting `/admin/feedback` calls `redirect('/admin')`.
- **`apps/api/tests/migrations/test_admin_dashboard.py`** — text-assertion test over the migration file (mirroring `apps/api/tests/migrations/`): the function is declared `security definer`, `stable`, `set search_path = ''`; `execute` is revoked from `public` and granted to `admin_ro`; the migration grants `admin_ro` `select on public.eval_candidate` (guarded by `to_regclass`); and it does **not** grant `admin_ro` any `select` on `auth.users` (a positive least-privilege assertion).

## Out of Scope

- Dataset composition (band/tag distribution from `eval/dataset.json`) — would need an `apps/api` read endpoint; not requested.
- Eval run history / scores over time — no run-result store exists yet; a separate feature.
- Time-windowed metrics ("last 7 days"), charts, trends.
- Any change to the **behavior** of the promote flow — it is relocated, not modified.
