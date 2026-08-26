import json

from scripts.promote_feedback import append_new_cases, candidate_to_case

CAND_A = "11111111-1111-1111-1111-111111111111"
CAND_B = "22222222-2222-2222-2222-222222222222"


def _candidate(inv="11112222aaaa", cand_id=CAND_A, **over):
    base = {
        "id": cand_id,
        "investigation_id": inv,
        "submission_snapshot": {"job_text": "hi", "company_name": "Acme"},
        "expected_max_band": "MODERATE",
        "expected_band": None,
        "tags": ["legit"],
    }
    base.update(over)
    return base


def test_candidate_to_case_shape_and_stable_id():
    case = candidate_to_case(_candidate())
    assert case["id"] == "feedback_11112222_111111111111"
    assert case["submission"] == {"job_text": "hi", "company_name": "Acme"}
    assert case["expected_max_band"] == "MODERATE"
    assert "source:feedback" in case["tags"]
    assert "legit" in case["tags"]
    assert case["origin_investigation_id"] == "11112222aaaa"


def test_expected_band_defaults_to_max_when_absent():
    # The eval loader requires expected_band; fall back to the ceiling.
    case = candidate_to_case(_candidate(expected_band=None))
    assert case["expected_band"] == "MODERATE"
    case2 = candidate_to_case(_candidate(expected_band="LOW"))
    assert case2["expected_band"] == "LOW"


def test_append_is_idempotent_and_collision_free():
    dataset = [{"id": "legit_saas_01", "tags": ["legit"]}]
    # Two DIFFERENT candidates (distinct uuids) from the same investigation.
    cands = [
        _candidate(inv="aaaabbbbcccc", cand_id=CAND_A),
        _candidate(inv="aaaabbbbcccc", cand_id=CAND_B),
    ]
    out, added = append_new_cases(dataset, cands)
    assert added == [
        "feedback_aaaabbbb_111111111111",
        "feedback_aaaabbbb_222222222222",
    ]
    assert len(out) == 3

    # Re-passing the SAME candidates (same uuids) is now genuinely
    # idempotent: candidate_to_case is a pure function of candidate identity,
    # so it recomputes the exact same ids, which collide with what's already
    # in `out` and are skipped.
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


def test_new_candidate_for_already_promoted_investigation_is_appended():
    # A prior (now-exported) promotion already put candidate A's case in the
    # dataset. A genuinely NEW candidate B for the SAME investigation must
    # still be appended under its own (different) id, not skipped.
    inv = "aaaabbbbcccc"
    dataset = [candidate_to_case(_candidate(inv=inv, cand_id=CAND_A))]
    assert dataset[0]["id"] == "feedback_aaaabbbb_111111111111"

    out, added = append_new_cases(dataset, [_candidate(inv=inv, cand_id=CAND_B)])
    assert added == ["feedback_aaaabbbb_222222222222"]
    assert len(out) == 2


def test_partial_failure_retry_does_not_duplicate():
    # Simulates a retry after main() wrote the dataset file but crashed
    # before marking the candidate 'exported' (or before the transaction
    # committed): the SAME candidate row is re-offered on the next run.
    # Identity-based ids must recognize it as already present, not append it
    # a second time under a new id.
    inv = "aaaabbbbcccc"
    dataset = [candidate_to_case(_candidate(inv=inv, cand_id=CAND_A))]

    out, added = append_new_cases(dataset, [_candidate(inv=inv, cand_id=CAND_A)])
    assert added == []
    assert len(out) == 1
    assert out == dataset
