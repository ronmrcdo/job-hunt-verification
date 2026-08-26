from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CI = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
NIGHTLY = (ROOT / ".github" / "workflows" / "live-eval-nightly.yml").read_text()


def test_band_filter_lists_every_decision_surface():
    # Only these paths tax a PR with the paid, network-bound live eval.
    for path in (
        "apps/api/src/app/rubric.py",
        "apps/api/src/app/graph/nodes/analysis.py",
        "apps/api/src/app/graph/nodes/report.py",
        "apps/api/src/app/graph/nodes/research.py",
        "apps/api/src/app/graph/nodes/intake.py",
        "apps/api/src/app/config.py",
        "apps/api/eval/dataset.json",
    ):
        assert path in CI, path


def test_live_eval_job_runs_the_live_eval_and_is_gated():
    assert "live-eval" in CI
    assert "pytest eval/test_eval.py --live" in CI
    # Only runs when the band filter fired.
    assert "needs.changes.outputs.band == 'true'" in CI


def test_deterministic_eval_still_runs_free_on_every_api_pr():
    # The stubbed harness must keep running unconditionally (unchanged job).
    assert "CHEAP_MODEL: stub-model" in CI


def test_nightly_covers_model_env_only_swaps():
    assert "schedule:" in NIGHTLY
    assert "workflow_dispatch:" in NIGHTLY
    assert "pytest eval/test_eval.py --live" in NIGHTLY
