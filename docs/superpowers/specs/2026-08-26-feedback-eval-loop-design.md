# Closed Feedback → Eval Loop Design

**Goal:** Turn real-world corrections into labeled eval cases instead of throwing them away. Today the only user-feedback path is a `mailto:` "report an issue" link in `ReportFooter.tsx` — it dead-ends in an inbox. Meanwhile the entire product thesis rests on two gated metrics (false-positive rate ~zero, citation-drop ~zero) measured against a *static, hand-labeled* dataset (`apps/api/eval/dataset.json`, 29 cases). This spec builds the loop the roadmap already promises: a report reader submits a structured verdict → an admin triages it → an approved item is promoted into the eval dataset **as a git PR**, never a silent write. It also adds a **PR-blocking CI gate** that runs the live eval whenever the band's decision logic changes, so a rubric or prompt edit can't silently regress the false-positive rate.

**Roadmap position:** Implements the V1 line **"feedback→eval loop"** (`README.md` §Versions & roadmap; `docs/superpowers/specs/2026-08-18-job-hunt-verification-design.md` §10 gated metrics). Nothing here weakens a guardrail — it hardens the metric that protects them all. This is a sibling spec to `2026-08-26-why-this-band-design.md`; the two share only the `FinalAssessment` contract and can ship in either order.

**Architecture:** The win is that a real investigation's `submission` is *already* the exact shape an eval case needs — `{company_name, job_text, job_url, recruiter_email}` plus an `expected_max_band`. So "promote" is: copy the submission off the `investigations` row, attach an admin-corrected `expected_max_band` + tags, and append a dataset-shaped case. Feedback never duplicates the run snapshot — it references `investigation_id`, and the submission/assessment/findings already live on that row.

Two trust boundaries define the whole design:

1. **Who may submit feedback** — any authenticated user, but only about their **own** investigation. Enforced by RLS (`user_id = auth.uid()`), identical to every other user-data table.
2. **Who may triage and promote** — an operator, gated at the **edge by Cloudflare Access**, not by a Supabase user role. Admin identity lives in CF Access's email allowlist; the app holds no `is_admin` column and no roles table. Cross-user reads happen through a **server-only** privileged Supabase client, never a permissive RLS policy.

The dataset itself stays human-reviewed at **two** layers: an admin approves each candidate in `/admin/feedback`, and the promotion still lands as a **git PR diff** a human merges. The admin gate can be misconfigured; git review is the backstop that keeps a bad label out of canon.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Zod / vitest (apps/web), Postgres + Supabase migrations (RLS), Python 3.12 / pytest (apps/api eval + promotion script), GitHub Actions (CI gate), Cloudflare Access (admin edge auth).

**Spec references:** `docs/superpowers/specs/2026-08-18-job-hunt-verification-design.md` §10 (gated metrics, the false-positive-rate-~zero product-killer), §9.1 (user-side sabotage — why user labels are advisory, never authoritative). Security posture baseline: `docs/security-review-2026-08-26.md` (service_role never in the browser bundle; RLS comprehensive; 404-not-403 no-leak convention). Prior art for migration-as-text-assertion tests: `apps/api/tests/migrations/`.

## Global Constraints

- **User feedback is advisory, never authoritative.** A verdict is a *signal to review*, not a label. No feedback row ever changes a live assessment, and no path writes to `eval/dataset.json` without (a) an admin's explicit promote action and (b) a merged git PR. This is the §9.1 sabotage principle applied to the eval loop itself: a malicious user cannot poison the dataset by spamming "too high" on a competitor's real posting.
- **RLS is not weakened.** The `anon` and `authenticated` keys stay deny-all cross-user, exactly as `docs/security-review-2026-08-26.md` verified. Admins read across users by **bypassing** RLS with a server-only privileged principal, never via a `USING (true)` or role-checked policy. No client UPDATE/DELETE path is introduced.
- **The service_role key never reaches the browser.** All `/admin/*` data access is server-only (Server Components / Route Handlers). The privileged client lives in a module whose first line is `import "server-only"`, so a client-component import fails the build. Its key comes from a non-`NEXT_PUBLIC_` env var. The browser continues to hold only the two `NEXT_PUBLIC_*` values.
- **Edge auth is verified in-app, not trusted blindly.** `/admin/*` validates the `Cf-Access-Jwt-Assertion` header against the CF Access team JWKS before doing anything; a missing/invalid assertion returns **404, not 403** (no existence leak, consistent with the rest of the app). This holds even if a request reaches the Traefik origin around Cloudflare.
- **Feedback is bounded server-side.** The `note` field carries a DB `CHECK` length bound; `verdict` is a CHECK-constrained enum; `wrong_finding_id` is validated against the referenced investigation's findings at promote time, not trusted from the client. (Mirrors M2 in the security review — client zod is not a trust boundary.)
- **The CI gate is scoped, not blanket.** The live-eval job blocks merge **only** on PRs that touch the band's decision surface (rubric, the four prompt sites, model-env defaults, or the dataset). Unrelated PRs are never taxed with a paid, network-bound job. Model-env-only swaps (which are not a code diff) are covered by a scheduled + `workflow_dispatch` run, documented as a known gap of the path filter.
- **Migrations are operator-applied; their tests are text assertions**, not executed SQL — follow `apps/api/tests/migrations/`.
- Test commands: web `cd apps/web && pnpm vitest run <path>`; API/eval/script `cd apps/api && uv run pytest <path> -v`.
- Per project convention, the commit step is omitted from this spec.

## Prerequisite (operator)

`jobverifai.ronmrcdo.dev` must be **fronted by Cloudflare** (proxied DNS or a CF tunnel) so an Access policy can apply to `/admin/*`. The CF account is already wired for the Inngest host. A **CF tunnel** is the recommended form because it also closes origin-bypass: the Traefik origin then accepts only Cloudflare traffic. If the domain is Traefik-only today, this is a deploy-time step, not a code change — but the app-level JWKS check (below) is built regardless, so the app is safe even before the network layer is tightened.

## Data Flow

```
Report page (authenticated user)
  └─ VerdictWidget  → INSERT feedback { investigation_id, verdict, wrong_finding_id?, note? }
                       RLS: user_id = auth.uid();  references the run snapshot, never copies it

Admin (/admin/feedback)  ── Cloudflare Access (email allowlist) ──┐
  server-only route:                                              │
    1. verify Cf-Access-Jwt-Assertion vs CF Access JWKS  (else 404)
    2. read feedback ⋈ investigations via server-only service_role client (RLS bypassed)
    3. admin sets corrected expected_max_band + tags → "promote"
         └─ INSERT eval_candidate { investigation_id, submission_snapshot, expected_max_band,
                                    tags, status: 'promoted', promoted_by (CF email) }

Promotion (operator runs script, opens PR)
  scripts/promote_feedback.py
    └─ read eval_candidate WHERE status='promoted' AND NOT exported
         → append dataset-shaped case to eval/dataset.json
              { id (stable, unique), submission, expected_band, expected_max_band,
                tags + 'source:feedback', origin_investigation_id }
         → mark candidate exported
    └─ output = a git diff → PR → human merges → now canon

CI gate (on the promotion PR AND any band-logic PR)
  path filter → live-eval job → pytest eval --live
    fail merge if: any 'legit'-tagged case bands HIGH/CRITICAL (FP != 0)
                   OR any case breaches its expected_max_band
```

## Components

### 1. `feedback` table (migration)
Columns: `id uuid pk`, `investigation_id uuid` (FK → investigations), `user_id uuid default auth.uid()`, `verdict text` CHECK in `('agree','too_high','too_low')`, `wrong_finding_id text null`, `note text null` CHECK `length(note) <= 2000`, `created_at timestamptz default now()`. RLS: authenticated users `insert`/`select` **their own** rows (`user_id = auth.uid()`); no update/delete grant to clients. `created_at` is server-forced (do not trust client) — same lesson as security-review H1. A partial unique index prevents duplicate feedback per (user, investigation).

### 2. `eval_candidate` table (migration)
The staging area between "admin approved" and "in the dataset." Columns: `id`, `investigation_id`, `submission_snapshot jsonb` (copied at promote time so a later investigation edit can't mutate a pending case), `expected_max_band text`, `expected_band text null`, `tags text[]`, `status text` CHECK in `('promoted','exported')`, `promoted_by text` (CF Access email), `created_at`, `exported_at null`. **Deny-all under RLS** (internal table, like `checkpoints`/`cache`) — reached only by the server-only privileged client.

### 3. `VerdictWidget` (web, client component)
Replaces the `mailto:` in `apps/web/components/report/ReportFooter.tsx`. Three-state verdict (agree / too high / too low); on "too high"/"too low" reveals an optional finding-picker sourced from the findings already on the page, plus an optional bounded note. One optimistic INSERT via the existing browser Supabase client (anon key, RLS-scoped). No new key, no server round-trip beyond Supabase.

### 4. Admin edge-auth module (web, server-only)
`apps/web/lib/admin/access.ts` — `import "server-only"`. Verifies `Cf-Access-Jwt-Assertion` against the CF Access JWKS (team domain + audience from server env), returns the caller's email or throws. Cached JWKS fetch. Used by every `/admin/*` route and by middleware's cheap header pre-check.

### 5. Privileged Supabase client (web, server-only)
`apps/web/lib/supabase/admin.ts` — `import "server-only"`; constructs a service_role client from `SUPABASE_SERVICE_ROLE_KEY` (server env, no `NEXT_PUBLIC_`). The **only** place the key is read. Never imported by a client component (build-enforced by `server-only`).

### 6. `/admin/feedback` route (web, Server Components)
Lists feedback joined to its investigation (submission + our assessment + verdict + note), newest first. A row expands to the full run; the admin edits `expected_max_band` + tags and clicks promote → a server action validates `wrong_finding_id` against the referenced findings, then inserts an `eval_candidate`. All reads/writes via the server-only privileged client, all behind CF Access + JWKS verification.

### 7. Middleware guard (web)
Add `/admin/:path*` handling: reject any request lacking the `Cf-Access-Jwt-Assertion` header (cheap first cut; full verification is in the route). Keep the existing matcher behavior for all other routes.

### 8. Promotion script (apps/api)
`scripts/promote_feedback.py` (run via `uv run`). Reads `eval_candidate WHERE status='promoted'`, appends dataset-shaped cases to `eval/dataset.json` with a **stable, collision-free id** (`feedback_<investigation_id[:8]>_<n>`), `tags` including `source:feedback`, and an `origin_investigation_id` for traceability. Idempotent (skips already-`exported` candidates; never emits a duplicate `id`). Marks candidates `exported`. Emits the diff for a human to open as a PR — it does not commit or push.

### 9. CI gate (GitHub Actions)
A `paths-filter` step flags PRs touching `apps/api/src/app/rubric.py`, `apps/api/src/app/graph/nodes/{analysis,report,research,intake}.py`, `apps/api/src/app/config.py`, or `apps/api/eval/dataset.json`. When flagged, a required `live-eval` job runs `uv run pytest eval/test_eval.py --live` with repo secrets, retry-once on transient network, and **fails the check** if the false-positive rate is nonzero or any case breaches its ceiling. A `schedule:` (nightly) + `workflow_dispatch` trigger runs the same job to catch model-env-only swaps the path filter can't see. The existing deterministic (stubbed) eval keeps running free on every PR, unchanged.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260826010000_feedback.sql` | **New.** `feedback` table + RLS (own-row insert/select) + `created_at` server-force + note CHECK + dedupe index. |
| `supabase/migrations/20260826010100_eval_candidate.sql` | **New.** `eval_candidate` staging table, deny-all RLS. |
| `apps/web/components/report/ReportFooter.tsx` | Replace `mailto:` with `<VerdictWidget />`. |
| `apps/web/components/report/VerdictWidget.tsx` | **New.** Verdict + finding-picker + note; one RLS-scoped INSERT. |
| `apps/web/lib/admin/access.ts` | **New, server-only.** CF Access JWKS verification → caller email. |
| `apps/web/lib/supabase/admin.ts` | **New, server-only.** service_role client; sole reader of the key. |
| `apps/web/app/admin/feedback/page.tsx` | **New.** Server Component triage queue. |
| `apps/web/app/admin/feedback/actions.ts` | **New.** `promote` server action (validates `wrong_finding_id`, inserts candidate). |
| `apps/web/middleware.ts` | Add `/admin/:path*` assertion-header pre-check. |
| `apps/api/scripts/promote_feedback.py` | **New.** Candidate → dataset-shaped case; idempotent; emits diff, no commit. |
| `apps/api/eval/test_eval.py` | Assert promoted `source:feedback` cases load and validate; FP-gate assertion reused by CI. |
| `.github/workflows/*.yml` | Path-filtered required `live-eval` job + nightly/`workflow_dispatch`. |
| `.env.production.example` / `docs/PRODUCTION.md` | Document `SUPABASE_SERVICE_ROLE_KEY` (server-only), CF Access team domain/audience env, and the CF-tunnel prerequisite. |

## Testing

- **RLS (`apps/api/tests/migrations/`, text-assertion):** feedback policies scope to `user_id = auth.uid()`; `eval_candidate` is deny-all; `created_at` is server-forced; no client update/delete grant.
- **VerdictWidget (vitest):** renders three states; finding-picker appears only on too-high/too-low; note is length-bounded; a submit issues exactly one INSERT with the right shape.
- **Edge auth (vitest):** a request with no/invalid `Cf-Access-Jwt-Assertion` yields 404 from an `/admin/*` route; a valid assertion resolves the email. `server-only` import guard verified by a build-time test (importing `lib/supabase/admin.ts` from a client boundary fails).
- **Promotion script (pytest):** a `promoted` candidate becomes a dataset-shaped case with a stable unique id, `source:feedback` tag, and origin id; re-running is idempotent (no dupes, `exported` skipped); output validates against the eval loader.
- **CI gate:** a dry-run proving the path filter triggers the live-eval job on a rubric edit and skips it on an unrelated web-only PR; the FP assertion fails the job when a `legit` case is forced to HIGH.
