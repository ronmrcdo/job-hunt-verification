# Eval dataset — how to update it

`dataset.json` is the hand-labeled corpus the quality gates run against. It is
**canon**: a case only lands here through a pull request, and a PR that touches it
triggers the required `live-eval` job. Nothing writes to it automatically.

Read [`../../../README.md#testing--evaluation`](../../../README.md) first for what
the harness *is*. This file is about changing what's in it.

---

## The two ways a case gets added

### A. From real user feedback (the usual path)

A user disagreed with a verdict on a real posting. That's the highest-value case
there is, and there's a pipeline for it:

```
report → user verdict  →  /admin triage → Promote  →  eval_candidate row
   →  /admin → Download  →  merge locally  →  PR  →  merge  →  Mark exported
```

```bash
# after downloading the candidates from /admin → Eval export
cd apps/api && uv run scripts/promote_feedback.py --from-file ~/Downloads/eval-candidates-YYYY-MM-DD.json
git diff eval/dataset.json     # review, then open a PR
```

The script shapes each candidate into a case with a stable id
(`feedback_<investigation[:8]>_<candidate[:12]>`), a `source:feedback` tag, and an
`origin_investigation_id` back-pointer. Re-running is a no-op — it dedupes on that
id — so when in doubt, re-run the merge.

**Full operator runbook, including why this can't run on the server and the
one-way status flip: [`docs/PRODUCTION.md` §6a](../../../docs/PRODUCTION.md).**
The short version: mark candidates exported **only after the PR merges**.

### B. By hand (a pattern you want covered before it bites a user)

Append an object to `dataset.json`. Give it a descriptive `id` and a
`description` that says what the case is *testing*, not just what it contains.

---

## Case shape

| Key | Required | Meaning |
|---|---|---|
| `id` | ✔ | Unique, stable. Never renumber an existing one — it's how a case is referenced in failure output. |
| `description` | ✔ | What this case proves. Write it for whoever debugs the failure at 2am. |
| `submission` | ✔ | The graph input. `job_text` is required; `company_name`, `recruiter_email`, `job_url` optional. |
| `expected_band` | ✔ | The band you believe is correct. One of `LOW` / `MODERATE` / `HIGH` / `CRITICAL`. |
| `expected_max_band` | ✔ | The **ceiling** that is actually asserted. See below. |
| `tags` | ✔ | Drives the gates and the required-span check. |
| `v1_only` | — | `true` excludes the case from the V0 span count. |
| `expect_safety_callout` | — | `true`/`false`: assert a §9.7 link-scan safety callout is present / absent. |
| `callout_forbids_company_name` | — | Callout text must not name the company (§9.1 sabotage defense). Requires `company_name`. |
| `expect_no_link_finding` | — | Assert no `linkscan*` finding at all. |
| `expect_unknown_link_finding` | — | Assert a *soft* `linkscan` finding exists with `user_safety_alert: false` — proves an open-redirect shape wasn't laundered into silent clearance. |

### `expected_band` vs `expected_max_band`

Only the **ceiling** is asserted (`test_case_band_within_expected`). The floor is
deliberately not enforced: in stubbed mode the LLM judgment that would reach it
isn't running, so a floor assertion would fail for the wrong reason.
`expected_band` still matters — it's the label a human reads, and
`promote_feedback.py` falls back to the ceiling when an admin only set a max.

### Tags that carry weight

- **`legit`** — enrolls the case in `test_false_positive_rate_zero`, the
  product-killing gate: **zero** `legit` cases may band `HIGH`/`CRITICAL`. No
  averaging, no threshold. Tag honestly; a mislabeled `legit` case either hides a
  real regression or blocks every PR.
- **`source:feedback`** — added automatically by the promote script. Provenance only.
- `test_dataset_has_required_span` requires at least 15 non-`v1_only` cases and at
  least one of each: `legit`, `obvious_scam`, `homoglyph`, `staffing_agency`,
  `contact_swap`, `injection`, `awkward_but_legit`. Deleting the last case carrying
  one of those tags fails the suite.

---

## Before you open the PR

```bash
cd apps/api
uv run pytest eval/test_dataset_shape.py -q     # schema + required span
uv run pytest eval/test_eval.py -v              # stubbed: deterministic, no keys needed
uv run pytest eval/test_eval.py --live -q       # real models + network (needs API keys)
```

Stubbed mode runs the deterministic spine for real (homoglyph, ATS allowlist,
domain match, injection scanner, citation validator, banding) and stubs only the
network and LLM nodes — so it catches most shape and rule errors for free. It is
**not** a substitute for `--live` on a case whose signal needs real judgment.

## What CI does with your PR

Touching `eval/dataset.json` flips the `band` path filter in
`.github/workflows/ci.yml`, which makes **`live-eval` a required check**: it runs
`pytest eval/test_eval.py --live` with repo secrets (retried once for transient
network) and fails the merge if the false-positive rate is nonzero or any case
breaches its ceiling. The same filter covers `rubric.py`, the `analysis`/`report`/
`research`/`intake` nodes, and `config.py` — so a band-logic change is gated by the
dataset, and a dataset change is gated by the band logic.

Model-env-only swaps produce no diff, so the path filter can't see them;
`live-eval-nightly.yml` runs the same job on a schedule to catch those.

---

## Rules

1. **Never edit a case to make a failing test pass.** If a case fails, either the
   graph regressed (fix the graph) or the label was wrong (fix the label, and say so
   in the PR body). Silently loosening `expected_max_band` converts a real
   regression into a permanent blind spot.
2. **Never renumber or reuse an `id`.** Failure output, `origin_investigation_id`,
   and the promote script's dedupe all key off it.
3. **Real postings get redacted, not reproduced.** A promoted case carries a real
   user's submission — check it for personal data before the PR, and remember the
   dataset is in git forever.
4. **One concern per case.** A case that tests five things tells you nothing about
   which one broke.
