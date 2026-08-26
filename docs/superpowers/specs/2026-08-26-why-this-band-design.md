# "Why This Band" — Rubric Trace Design

**Goal:** Make the deterministic risk band *explain itself*. `compute_assessment` (`apps/api/src/app/rubric.py`) already walks every §5 rule in order — base score → one-band cap → soft-only cap → sabotage cap → payment/credential floors → coverage→confidence — but it **discards the reasoning** and returns only the final band. This spec makes that pure function accumulate a structured `RubricTrace` and return it on `FinalAssessment`, then renders it two ways from that single source of truth: a safe, plain-language "why" in the user report, and a full raw trace in the operator surface for rubric tuning.

**Roadmap position:** Serves the differentiation thesis stated in `README.md` §"The one decision everything follows from" — *the judge is code, not a prompt*. Surfacing which code rules fired is that thesis made visible, and it doubles as the primary rubric-debugging tool. Sibling spec to `2026-08-26-feedback-eval-loop-design.md`; they share only the `FinalAssessment` contract (the admin surface there can render this trace) and can ship in either order.

**Architecture:** The trace is emitted **only** by `rubric.py` — the one place the band is decided — so there is never a second, drifting explanation. `compute_assessment` builds a `RubricTrace` as it applies each rule: a `base_band` from the raw score, then one `TraceStep` per rule that *actually fired* (skipped rules are omitted, so the trace reads as "what moved this result"), then the coverage→confidence detail. Every step's human-readable `because` is a **static, code-authored** string — sourced from the explanatory comment already sitting on each rule — so no prose is invented at runtime and **nothing attacker-supplied ever enters the trace**. `RubricTrace` rides on `FinalAssessment`, flows through the FastAPI Pydantic model, regenerates `packages/api-types`, and reaches the web report as a real type.

Two renderings, no second source of truth:
- **User-facing** (report page): plain-language, rule-level, **no raw score / no percentage** (spec §5 rule 5 forbids exposing a numeric verdict). Example: *"A new domain on its own can't push a result past MODERATE,"* *"We set a floor of HIGH because the posting requests an up-front fee."*
- **Operator-facing** (`/admin`, debug): the full trace — `base_band`, every step with its effect delta, the coverage math — for tuning the rubric.

**Tech Stack:** Python 3.12 / pydantic / pytest (apps/api), OpenAPI → `packages/api-types` type generation (`pnpm gen:types`), Next.js 16 / React 19 / TypeScript / vitest (apps/web).

**Spec references:** `docs/superpowers/specs/2026-08-18-job-hunt-verification-design.md` §5 (the rubric rules, verbatim source of the `because` strings), §5 rule 5 (bands only — never expose a percentage/score as a verdict), §9.5 (defamation/output safety — the language-linter posture the user rendering must respect). Contract-generation mechanism: `README.md` §"Shared API contract" (`pnpm gen:types`, `pnpm check:types-stale`). Implementation surface: `apps/api/src/app/rubric.py` (`compute_assessment`), `apps/api/src/app/graph/state.py` (`FinalAssessment`), `apps/api/src/app/graph/nodes/banding.py`.

## Global Constraints

- **The trace is code-authored, never model- or attacker-authored.** Every `because` string is a static constant keyed by rule id. No finding `claim`, source excerpt, company name, or any other submission-derived text is interpolated into the trace. This keeps the §9.2 injection boundary intact: the explanation cannot be steered by fetched/pasted content.
- **No numeric verdict is ever exposed to the user (spec §5 rule 5).** The raw `score`, per-finding points, and `base_band`'s underlying number stay **out of the user-facing rendering**. The user sees rule-level reasons only. Raw numbers appear solely in the operator/debug rendering. A vitest test asserts no digit-score leaks into the user surface.
- **The trace is derived, never load-bearing.** `RubricTrace` is a *record of* the decision the existing rules already make; it must not change any band. Adding the trace leaves every current `compute_assessment` band/confidence output byte-for-byte identical — the existing rubric tests must pass untouched, and new tests assert the *trace* alongside the unchanged band.
- **One source of truth.** Both renderings consume the same `RubricTrace`. No component recomputes or re-describes the reasoning. If a rule changes, its `because` constant changes in one place and both renderings follow.
- **The user rendering respects the defamation posture (spec §9.5).** The reasons describe *our rubric* ("a single soft signal can't move the band more than one step"), not accusations against a named entity, so they are structurally safe — but the report copy is reviewed against the same bar the `language_linter` enforces. No new declarative claim about a named company/person is introduced.
- **The contract break is intended.** Adding `RubricTrace` to `FinalAssessment` changes the OpenAPI schema; `pnpm gen:types` must be run and `pnpm check:types-stale` must pass, so the web build fails loudly until the frontend consumes the new field.
- Test commands: API `cd apps/api && uv run pytest <path> -v`; web `cd apps/web && pnpm vitest run <path>`.
- Per project convention, the commit step is omitted from this spec.

## The Trace Model

Added to `apps/api/src/app/graph/state.py`:

```
RuleId = Literal[
  "base_score", "one_band_cap", "soft_only_cap", "sabotage_cap",
  "payment_floor", "credential_floor", "agency_reframe",
]

class TraceStep(BaseModel):
    rule: RuleId
    effect: str          # e.g. "cap→MODERATE", "floor→HIGH", "reframe x0.5" (operator-facing)
    because: str         # static, code-authored plain-language reason (user-safe)

class RubricTrace(BaseModel):
    base_band: Band                 # band from raw score, pre-caps/floors (operator-only)
    steps: list[TraceStep]          # only rules that FIRED, in application order
    covered_categories: list[Category]   # which of the 6 dimensions were source-backed
    # confidence itself already lives on FinalAssessment; this explains it.

class FinalAssessment(BaseModel):
    band: Band
    confidence: Confidence
    summary: str
    coverage: float
    trace: RubricTrace              # NEW
```

`agency_reframe` records as a step when `_agency_reframe_active(signals)` is true **and** it actually altered a finding's contribution — so the trace reflects real effect, not mere eligibility.

## Data Flow

```
compute_assessment(state)                         # rubric.py, pure fn
  ├─ score → base_band                            → trace.base_band
  ├─ each §5 rule: if it fires, append TraceStep(rule, effect, BECAUSE[rule])
  ├─ coverage → covered_categories                → trace.covered_categories
  └─ return FinalAssessment(..., trace=RubricTrace(...))
        │
        ▼  (persisted on the investigation row's `assessment` jsonb, unchanged path)
FastAPI FinalAssessment (Pydantic)  ──OpenAPI──▶  packages/api-types  ──▶  web
        │                                                                    │
        ├─ report page: WhyThisBand — renders trace.steps[].because          │  user-safe, no score
        └─ /admin (feedback surface): full trace — base_band, effects, coverage
```

## Components

### 1. `RubricTrace` + `because` constants (apps/api)
The models above in `state.py`; a `BECAUSE: dict[RuleId, str]` constant in `rubric.py` holding one static reason per rule, lifted from each rule's existing explanatory comment. Single source; both renderings key off it.

### 2. `compute_assessment` trace accumulation (apps/api)
Thread a `steps: list[TraceStep]` through the function. At each existing rule site that *changes* the band (the `_cap`/`_floor` calls) or a finding's contribution (agency reframe), append a step. **No band logic changes** — only observation is added. `base_band` is captured right after `_band_for_score`. `covered_categories` reuses the exact set `_coverage` already computes (refactor `_coverage` to return the set + fraction so there's no second computation).

### 3. `WhyThisBand` (web, report page)
A report-page section listing `trace.steps[].because` as plain-language bullets, headed by the band + confidence already shown. Renders **only** `because` strings — never `effect`, `base_band`, or any number. Empty or single-step traces (e.g. a clean LOW with no caps/floors) render a neutral "no risk rules were triggered" line rather than nothing.

### 4. Operator trace view (web, `/admin`)
Within the admin surface (shared with the feedback-loop spec), render the **full** trace for a selected investigation: `base_band`, each step's `rule` + `effect` + `because`, and `covered_categories` vs the six dimensions — the rubric-tuning view. Behind the same CF Access + server-only boundary defined in `2026-08-26-feedback-eval-loop-design.md`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/app/graph/state.py` | Add `RuleId`, `TraceStep`, `RubricTrace`; `FinalAssessment.trace`. |
| `apps/api/src/app/rubric.py` | `BECAUSE` constants; accumulate `steps`; capture `base_band`; return `RubricTrace`. `_coverage` returns `(set, fraction)`. |
| `apps/api/src/app/graph/nodes/banding.py` | Pass the assembled trace through (no logic change — `compute_assessment` owns it). |
| `packages/api-types/*` | Regenerated via `pnpm gen:types` (contains `RubricTrace`, `TraceStep`). |
| `apps/web/components/report/WhyThisBand.tsx` | **New.** User-facing rule-level reasons; no numbers. |
| `apps/web/components/report/*` | Mount `WhyThisBand` in the report layout. |
| `apps/web/app/admin/**` | Operator full-trace view (shares the feedback-spec admin surface). |
| `apps/web/lib/**` view-models | Map `trace` into the report/admin view-models. |

## Testing

- **Rubric trace (pytest), the core of this spec:** for known inputs, assert both the unchanged band **and** the trace — single soft suspicious finding → `one_band_cap` step present and `final band == MODERATE`; a payment finding → `payment_floor` step + `floor→HIGH`; a named company with no web-verified suspicion → `sabotage_cap` step; a clean legit posting → no cap/floor steps. This upgrades the rubric tests to assert *why*, not just *what*.
- **Golden coverage:** every `RuleId` has a non-empty `BECAUSE` entry (parametrized test), so a new rule can't ship without its reason.
- **No-regression:** existing `compute_assessment` band/confidence assertions pass untouched; a property test that `trace` never alters `band`.
- **`_coverage` refactor:** returns the same fraction it did before for existing cases (numeric equivalence test) plus the correct category set.
- **Contract:** `pnpm check:types-stale` passes after regeneration; a web type test consumes `FinalAssessment.trace`.
- **User rendering (vitest):** `WhyThisBand` shows one bullet per fired rule; asserts **no numeric score** appears in the rendered output; the empty-trace case renders the neutral line.
