"""Eval harness (Task 6.4): runs the investigation graph per V0 dataset case
and asserts the spec's gated metrics (spec §10):

    - band accuracy (`test_case_band_within_expected`, per case)
    - false-positive rate ~zero HIGH/CRITICAL on legit cases
      (`test_false_positive_rate_zero`) — THE product-killing metric
    - citation-drop count ~zero (`test_citation_drops_near_zero`)
    - cost & latency per case, surfaced via `app.cost_tracker.summarize`
      (`test_cost_and_latency_reported`)

Every result is tagged with a `model_config` string (from `CHEAP_MODEL`/
`STRONG_MODEL`) recorded in failure messages, per the brief.

LLM/network are stubbed by default (see conftest.py) so this file runs
deterministically with no Postgres, no real OpenAI/Tavily calls, and no
`--live` flag:

    cd apps/api && uv run pytest eval/test_eval.py -v

`--live` runs the same assertions against the real graph (real models,
real network) for the manual Luna vs Terra comparison the spec mandates
(§6, §331):

    CHEAP_MODEL=... STRONG_MODEL=<luna> uv run pytest eval/test_eval.py --live
    CHEAP_MODEL=... STRONG_MODEL=<terra> uv run pytest eval/test_eval.py --live

Stubbed-mode band accuracy is meaningful for the cases whose signal is
carried by the deterministic spine (homoglyph, injection scan, the
rule-based text markers standing in for analysis) — see conftest.py's
docstring. It is NOT a substitute for `--live` runs against real findings;
`test_case_band_within_expected` only asserts the case doesn't exceed its
tagged ceiling, never that it hits the tagged floor, precisely because the
floor is not always reachable without live LLM judgment.
"""
import json
import os
import pathlib
import time

import pytest

from app.cost_tracker import summarize
from app.graph.state import RawSubmission

CASES = json.loads(pathlib.Path(__file__).with_name("dataset.json").read_text())
V0 = [c for c in CASES if not c.get("v1_only")]
MODEL_CONFIG = f"{os.getenv('CHEAP_MODEL', '?')}|{os.getenv('STRONG_MODEL', '?')}"

_BANDS = ["LOW", "MODERATE", "HIGH", "CRITICAL"]


def _band_index(b):
    return _BANDS.index(b)


@pytest.mark.parametrize("case", V0, ids=[c["id"] for c in V0])
@pytest.mark.asyncio
async def test_case_band_within_expected(case, eval_runner):
    state = await eval_runner(RawSubmission(**case["submission"]))
    got = state.assessment.band
    assert _band_index(got) <= _band_index(case["expected_max_band"]), (
        f"[{MODEL_CONFIG}] {case['id']}: {got} exceeded max {case['expected_max_band']}"
    )


_CALLOUT_CASES = [c for c in V0 if "expect_safety_callout" in c]


@pytest.mark.parametrize("case", _CALLOUT_CASES, ids=[c["id"] for c in _CALLOUT_CASES])
@pytest.mark.asyncio
async def test_case_safety_callouts(case, eval_runner):
    """§9.7 weaponized-recruitment regressions: link-scan safety callouts must
    surface exactly where expected (danger classes) and stay silent on
    neutral/soft classes (ATS allowlist, app store, open-redirect shape) —
    the false-positive guard for this feature. Where `callout_forbids_company_name`
    is set, the callout text must be entity-decoupled (spec §9.1 sabotage
    defense: an unverified posting-text finding must never name the company
    it's about)."""
    state = await eval_runner(RawSubmission(**case["submission"]))
    callouts = state.deterministic_signals.get("safety_callouts", [])
    if case["expect_safety_callout"]:
        assert callouts, f"[{MODEL_CONFIG}] {case['id']}: expected a safety callout, got none"
    else:
        assert not callouts, (
            f"[{MODEL_CONFIG}] {case['id']}: expected no safety callout, got {callouts}"
        )
    if case.get("callout_forbids_company_name"):
        name = (case["submission"].get("company_name") or "").strip()
        assert name, f"{case['id']}: callout_forbids_company_name set but no company_name given"
        for text in callouts:
            assert name.lower() not in text.lower(), (
                f"[{MODEL_CONFIG}] {case['id']}: safety callout leaked company name "
                f"{name!r}: {text!r}"
            )
    if case.get("expect_no_link_finding"):
        link_findings = [f for f in state.findings if f.id.startswith("linkscan")]
        assert not link_findings, (
            f"[{MODEL_CONFIG}] {case['id']}: expected no link-scan finding, got "
            f"{[f.claim for f in link_findings]}"
        )
    if case.get("expect_unknown_link_finding"):
        # Proves the open-redirect shape is NOT laundered through the ATS
        # allowlist into silent clearance: a soft `unknown` finding (no
        # user_safety_alert) must actually be present, not merely absent of a
        # callout -- `expect_safety_callout: false` alone can't distinguish a
        # correct soft-unknown finding from an incorrect false-clearance
        # (no finding at all), since both produce zero callouts.
        link_findings = [f for f in state.findings if f.id.startswith("linkscan")]
        assert link_findings, (
            f"[{MODEL_CONFIG}] {case['id']}: expected a soft `unknown` link-scan "
            "finding (the open-redirect shape must not be cleared as neutral), "
            "but no linkscan finding was present in state.findings at all"
        )
        assert all(f.user_safety_alert is False for f in link_findings), (
            f"[{MODEL_CONFIG}] {case['id']}: expected the link-scan finding(s) to be "
            f"soft (user_safety_alert=False), got {[(f.id, f.user_safety_alert) for f in link_findings]}"
        )


@pytest.mark.asyncio
async def test_false_positive_rate_zero(eval_runner):
    """THE product-killing metric (spec §10): legit postings must never be
    surfaced as HIGH/CRITICAL. Zero tolerance — no averaging, no threshold."""
    legit = [c for c in V0 if "legit" in c["tags"]]
    bad = []
    for c in legit:
        st = await eval_runner(RawSubmission(**c["submission"]))
        if _band_index(st.assessment.band) >= _band_index("HIGH"):
            bad.append(f"{c['id']}={st.assessment.band}")
    assert not bad, f"[{MODEL_CONFIG}] legit cases flagged HIGH/CRITICAL: {bad}"


@pytest.mark.asyncio
async def test_citation_drops_near_zero(eval_runner):
    total = 0
    per_case = {}
    for c in V0:
        st = await eval_runner(RawSubmission(**c["submission"]))
        drops = st.deterministic_signals.get("citation_drops", 0)
        total += drops
        if drops:
            per_case[c["id"]] = drops
    assert total <= len(V0), f"[{MODEL_CONFIG}] citation drops high: {total} ({per_case})"


@pytest.mark.asyncio
async def test_cost_and_latency_reported(eval_runner):
    """Surfaces cost/latency per case (spec §10) via `cost_tracker.summarize`.
    In stub mode every node is either free (no LLM call) or a `NodeUsage`
    with `usd=0.0` (unpriced model id), so this is really asserting the
    reporting plumbing works end-to-end, not gating a $ budget — the budget
    gate is meaningful under `--live`."""
    rows = []
    for c in V0:
        t0 = time.monotonic()
        st = await eval_runner(RawSubmission(**c["submission"]))
        latency_s = time.monotonic() - t0
        cost = summarize(st.cost_events)
        rows.append({"id": c["id"], "latency_s": round(latency_s, 3), **cost})
    assert len(rows) == len(V0)
    for row in rows:
        assert row["total_usd"] >= 0.0
        assert row["latency_s"] >= 0.0
    over_budget = [r["id"] for r in rows if r["over_budget"]]
    assert not over_budget, f"[{MODEL_CONFIG}] cases over cost budget: {over_budget}"


def test_promoted_feedback_cases_load_and_validate():
    """A source:feedback case built by the promotion script must satisfy the
    same loader invariants as hand-authored cases (spec Testing)."""
    from scripts.promote_feedback import candidate_to_case

    case = candidate_to_case(
        {
            "investigation_id": "deadbeefcafef00d",
            "submission_snapshot": {"job_text": "Remote role, apply via email."},
            "expected_max_band": "MODERATE",
            "expected_band": None,
            "tags": ["legit"],
        },
        seq=0,
    )
    assert case["expected_band"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
    assert "job_text" in case["submission"]
    assert "source:feedback" in case["tags"]
    # A promoted case must be runnable by the harness's submission constructor.
    RawSubmission(**case["submission"])
