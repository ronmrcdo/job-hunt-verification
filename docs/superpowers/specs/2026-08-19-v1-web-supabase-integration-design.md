# V1 Web ⇄ Supabase Integration (Auth, RLS Data Access, Realtime)

**Date:** 2026-08-19
**Status:** Approved design
**Backend spec:** `docs/superpowers/specs/2026-08-19-v1-background-inngest-supabase-design.md` (esp. §7 frontend contract)
**Backend plan:** `docs/superpowers/plans/2026-08-19-v1-background-inngest-supabase.md`

## 1. Overview

The V1 backend moved investigations to a Supabase-first model: the browser
talks to Supabase directly for auth, submit (row INSERT under RLS), live
step progress (Realtime), and reads (SELECT under RLS). There are no
user-facing Python routes anymore. This spec covers the **web app
migration** (`apps/web`) that implements the §7 frontend contract.

The current web app is a client-only, four-step flow (landing → sign-in →
details → scripted "running" animation → report) backed by a synchronous
REST API, a per-browser `X-Owner-Key`, and the `@job-hunt/api-types`
workspace package. All of that is replaced:

- **Supabase Auth** (email/password + Google OAuth) replaces the fake
  local sign-in and the owner-key.
- **`@supabase/ssr`** provides cookie-based sessions; Next.js middleware
  refreshes tokens and guards protected routes. SSR is preserved.
- **supabase-js data access** replaces `lib/api.ts` (INSERT to submit,
  SELECT-first reads, Realtime for live steps).
- The post-submit experience is **one unified route** that switches on
  investigation `status`, replacing the split running/report routes.
- The V0 web data layer is **deleted** here, which unblocks the deferred
  backend teardown (Task 6 of the backend plan) to ride the same branch to
  `main`.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Session strategy | `@supabase/ssr` + Next.js middleware (cookie sessions; SSR preserved; server components read auth) |
| Auth providers | Email/password (with email confirmation) **and** Google OAuth |
| Progress screen | Real Realtime `investigation_steps`, SELECT-first; scripted animation removed |
| Client state | Keep a trimmed `flow-context` for the pre-auth draft carry; **no Zustand** |
| Investigation view | One unified `/investigations/[id]` route, switches on `status` |
| Authed home | `/verify` — new-check form (paste + details) + a recent-checks strip (~5) |
| Full history page | Not now; recent strip only (data supports adding one later) |
| Local dev | Real Supabase only; **no mock mode** (fixtures survive as test data only) |
| V0 teardown | Remove `lib/ownerKey.ts`, `lib/api.ts`, `@job-hunt/api-types` import in this pass |
| Types | Hand-author `lib/database.types.ts` to the migration schema; operator regenerates via `supabase gen types` and overwrites |

## 3. Routing & user flow

```
/                     Public landing + paste (front door for anonymous users).
                        "Start" routes to /sign-in (draft carried in flow-context).
/sign-in              Supabase auth: email/password + Google.
                        Success → /verify (or resume draft on /verify).
/auth/callback        Route handler: exchangeCodeForSession (OAuth return +
                        email-confirmation link) → redirect to /verify.
/verify               Authenticated home:
                        • New-check form = paste field (ScanField) + optional
                          details (company_name, recruiter_email, job_url).
                          Validate → INSERT investigations → /investigations/[id].
                        • Recent-checks strip: last ~5 own investigations,
                          newest first, each linking to its report.
/investigations/[id]  Unified view, switches on status:
                        queued|running     → checklist (live steps)
                        done|deadline_exceeded → report
                        failed             → error panel
                        (RLS/no row)       → not-found panel
```

**Flow paths:**

- **Anonymous:** paste on `/` → `/sign-in` → land on `/verify` with the
  pasted text **prefilled** in the new-check form (details empty), ready to
  complete and submit.
- **Signed-in:** use the `/verify` form directly; recent strip shows prior
  checks.

**Middleware** protects `/verify` and `/investigations/*`; unauthenticated
hits redirect to `/sign-in`. The bare authenticated home is `/verify`.

**Deleted routes:** `app/check/new/`, `app/check/running/`,
`app/report/[id]/`, and the `app/investigations/[id]` redirect shim (which
becomes the real unified view). `DetailsForm`/`FieldValueRail`/`ScanField`
and all report/checklist **presentational** components are kept and
rehomed; only their data source changes.

## 4. Supabase layer

### 4.1 Clients (`lib/supabase/`)

- `client.ts` — `createBrowserClient` (`@supabase/ssr`) for client
  components.
- `server.ts` — `createServerClient` bound to Next's `cookies()` for
  server components and route handlers.
- `middleware.ts` — `updateSession(request)` helper: refreshes tokens and
  mirrors auth cookies onto the response. The root `middleware.ts` calls it
  and performs the route guard for `/verify` and `/investigations/*`.
- `database.types.ts` — TypeScript types for the two tables, hand-authored
  to match the migrations. Header comment instructs the operator to
  regenerate with `supabase gen types typescript --local` and overwrite.
  Domain aliases `Investigation` and `InvestigationStep` derive from it,
  replacing the `@job-hunt/api-types` import.

### 4.2 Data access (`lib/investigations.ts`)

Thin, typed, UI-free functions. Each takes a supabase client so it works
from server and browser:

- `createInvestigation(client, submission) → { id } | InvestigationError`
  — INSERT `{ submission: { job_text, company_name?, recruiter_email?,
  job_url? } }`. RLS `with check (user_id = auth.uid())`, the
  `force_investigation_defaults` trigger, and the DB CHECKs set/validate
  server columns. Constraint violations return a typed error surfaced on
  the form.
- `getInvestigation(client, id) → { investigation, steps } | null`
  — SELECT the row and its steps (ordered `display_order`). Returns `null`
  when RLS yields 0 rows (→ not-found). Used SSR-first by
  `/investigations/[id]`.
- `recentInvestigations(client, limit = 5) → Investigation[]`
  — SELECT own rows, `order by created_at desc limit 5`, for the `/verify`
  recent strip.

### 4.3 Realtime (`lib/investigations-live.ts`)

- Pure reducers (unit-testable without a socket):
  - `applyStepEvent(steps, payload) → steps` — upsert by `step_key`,
    re-sort by `display_order`.
  - `applyStatusEvent(inv, payload) → inv` — apply the row status flip.
- Hook `useInvestigationLive(id, initial)`:
  - Seeds from the server SELECT (`initial`); renders immediately.
  - While `queued`/`running`: subscribes to `investigation_steps`
    INSERT/UPDATE filtered `investigation_id=eq.{id}` and the
    `investigations` row UPDATE.
  - On terminal status **or** channel error → unsubscribe and re-SELECT
    once (authoritative final state). Realtime unavailable ⇒ falls back to
    the SELECT it already holds; never stuck (§7.5).

### 4.4 View model (`lib/report-view-model.ts`, refactored)

`toReportViewModel` takes the **DB row shape** (`submission`,
`assessment`, `findings`, `sources`, `what_to_verify`, `check_count` as
jsonb/columns) instead of `InvestigationResponse`. The submitted-data grid
reads from the row's own `submission` (real persisted data), so a returning
user on another device — with no flow state — still renders correctly.
Band/confidence separation, URL defanging, conversation-provenance label,
and the neutral "couldn't verify" copy are unchanged (still guarded by the
product-rules test suite).

## 5. Auth & validation

### 5.1 Auth

- `AuthForm` (rewrite): email/password via
  `supabase.auth.signInWithPassword` (sign-in) / `signUp` (create-account,
  which triggers Supabase email confirmation), plus a **"Continue with
  Google"** button via `signInWithOAuth({ provider: 'google', options: {
  redirectTo: <origin>/auth/callback } })`.
- `/auth/callback` route handler: `exchangeCodeForSession(code)` handles
  both the OAuth return and the email-confirmation link, then redirects to
  `/verify` (or a saved draft-resume target).
- Sign-out: an action in `SiteHeader` calling `supabase.auth.signOut()` →
  `/`, rendered only when a session exists.
- The password never enters flow state — it lives only in the form and is
  passed straight to Supabase.

### 5.2 Client validation (react-hook-form + zod, `lib/validation.ts`)

- `submissionSchema`: `job_text` required, 1–40 000 chars (mirrors the DB
  CHECK, so oversize/empty is caught before INSERT); `company_name`
  optional; `recruiter_email` optional email; `job_url` optional url. Wired
  to the `/verify` new-check form via `zodResolver`.
- `authSchema`: valid email, password ≥ 8. Wired to `AuthForm`.
- Client validation is the good-UX first line; DB constraint violations
  that still occur map back onto the form (§7.2).

### 5.3 flow-context (trimmed)

Reduced to the pre-auth **draft carry** only (`jobInput` + optional detail
fields) so an anonymous paste survives the `/sign-in` redirect and
prefills `/verify`. The `signedIn`/`authEmail`/`authMode` fields are
removed — auth state now comes from the real Supabase session. `submitted`
derivation moves to the DB-row view model. No Zustand.

## 6. Status → view & error handling

**`/investigations/[id]` status mapping:**

- `queued` / `running` → checklist (`StepList`/`StepRow` driven by real
  step rows; `progress-script.ts` deleted).
- `done` / `deadline_exceeded` → report (`deadline_exceeded` renders the
  best-effort report; unverifiable findings already lower confidence — no
  extra banner beyond existing copy). A cache-hit investigation is `done`
  with no `investigation_steps` rows; the report view renders from
  `assessment`/`findings`/`sources` and must tolerate an empty step list
  (no checklist).
- `failed` → concise error panel with a "run it again" path; worker
  internals never surface (§8).
- SELECT `null` (RLS/no row) → not-found panel (reuses the existing NOT
  FOUND state).

**Errors:**

- Auth: inline form messages (bad credentials, unconfirmed email, OAuth
  failure on `/auth/callback`).
- INSERT constraint violation → mapped onto the new-check form.
- Session expiry mid-session → middleware refresh; hard failure bounces to
  `/sign-in`.

## 7. Testing

Vitest + Testing Library, mocking `@supabase/ssr` at the module boundary —
**no live DB** (honors the operator-only constraint). Tests assert
roles/text/`data-*`, never Tailwind classes; `MotionGlobalConfig.skipAnimations`
stays on.

- **Pure/unit:** `submissionSchema`/`authSchema`; `applyStepEvent` /
  `applyStatusEvent` reducers; refactored `toReportViewModel(dbRow)`; the
  status→view selector.
- **Data access:** `createInvestigation` / `getInvestigation` /
  `recentInvestigations` against a faked supabase client — asserts the
  right table/columns/filters/order and `null` on empty.
- **Components:** `AuthForm` (RHF validation, password never escapes, mode
  toggle, Google button invokes OAuth); `/verify` new-check form
  (validate → INSERT → navigate) and recent strip; unified investigation
  view (checklist vs report vs failed vs not-found by status).
- **Kept:** existing presentational-component and product-rule guardrail
  tests; their fixtures shift from `InvestigationResponse` to the DB row
  shape.

## 8. Deletions (this branch)

Removing these unblocks the backend V0 teardown to merge on the same
branch:

- `apps/web/lib/ownerKey.ts`
- `apps/web/lib/api.ts` (replaced by `lib/investigations.ts`)
- The `@job-hunt/api-types` workspace import + `package.json` dependency
- `app/check/new/`, `app/check/running/`, `app/report/[id]/` routes and the
  `app/investigations/[id]` redirect shim
- `components/progress/progress-script.ts`
- The `NEXT_PUBLIC_MOCK*` code paths in the data layer

## 9. Dependencies & config

- **Add:** `@supabase/supabase-js`, `@supabase/ssr`, `react-hook-form`,
  `zod`, `@hookform/resolvers`.
- **Remove:** `@job-hunt/api-types` (workspace dep).
- **Env (`apps/web`):** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Documented in the web README; no secret
  values in the repo. Google OAuth provider is configured in the Supabase
  project by the operator (spec §9).

## 10. Out of scope

Backend worker/migrations (owned by the backend plan — already authored).
Running any Supabase process, migration, or live-DB test (operator-only).
Full history/archive page, per-user rate limiting, conversation paste,
re-research loop, Stripe (future V1 items). Regenerating
`database.types.ts` from the live stack (operator-run; the hand-authored
file is the reviewed stand-in until then).
