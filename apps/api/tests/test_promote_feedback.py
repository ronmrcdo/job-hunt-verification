import json

from scripts.promote_feedback import append_new_cases, candidate_to_case


def _candidate(inv="11112222aaaa", **over):
    base = {
        "investigation_id": inv,
        "submission_snapshot": {"job_text": "hi", "company_name": "Acme"},
        "expected_max_band": "MODERATE",
        "expected_band": None,
        "tags": ["legit"],
    }
    base.update(over)
    return base


def test_candidate_to_case_shape_and_stable_id():
    case = candidate_to_case(_candidate(), seq=0)
    assert case["id"] == "feedback_11112222_0"
    assert case["submission"] == {"job_text": "hi", "company_name": "Acme"}
    assert case["expected_max_band"] == "MODERATE"
    assert "source:feedback" in case["tags"]
    assert "legit" in case["tags"]
    assert case["origin_investigation_id"] == "11112222aaaa"


def test_expected_band_defaults_to_max_when_absent():
    # The eval loader requires expected_band; fall back to the ceiling.
    case = candidate_to_case(_candidate(expected_band=None), seq=1)
    assert case["expected_band"] == "MODERATE"
    case2 = candidate_to_case(_candidate(expected_band="LOW"), seq=2)
    assert case2["expected_band"] == "LOW"


def test_append_is_idempotent_and_collision_free():
    dataset = [{"id": "legit_saas_01", "tags": ["legit"]}]
    cands = [_candidate(inv="aaaabbbbcccc"), _candidate(inv="aaaabbbbcccc")]  # same inv twice
    out, added = append_new_cases(dataset, cands)
    # two candidates from the same investigation get distinct ids by seq
    assert added == ["feedback_aaaabbbb_0", "feedback_aaaabbbb_1"]
    assert len(out) == 3

    # re-running against the now-updated dataset adds nothing
    out2, added2 = append_new_cases(out, cands)
    assert added2 == []
    assert len(out2) == 3


def test_appended_cases_validate_against_dataset_shape():
    # Mirror eval/test_dataset_shape.py's invariants.
    dataset, _ = append_new_cases([], [_candidate()])
    for c in dataset:
        assert c["expected_band"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
        assert "job_text" in c["submission"]
        assert isinstance(json.dumps(c), str)  # JSON-serializable
