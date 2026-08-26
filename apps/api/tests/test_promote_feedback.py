import json

from scripts.promote_feedback import append_new_cases, candidate_to_case, reconcile

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


def test_reconcile_exports_a_stranded_prior_run_candidate():
    # A prior run wrote candidate A's case to the dataset but crashed before
    # (or without) marking it 'exported' — status is still 'promoted' in the
    # DB. reconcile must still put A's id in export_ids even though it isn't
    # newly appended this run, so it stops being stranded forever.
    inv = "aaaabbbbcccc"
    cand_a = _candidate(inv=inv, cand_id=CAND_A)
    dataset = [candidate_to_case(cand_a)]

    new_dataset, export_ids = reconcile(dataset, [cand_a])
    assert new_dataset == dataset  # nothing new appended
    assert export_ids == [CAND_A]


def test_reconcile_export_ids_only_includes_candidates_actually_in_dataset():
    # A candidate whose case never makes it into new_dataset must never be
    # reported as exportable — this is what prevents a concurrently-promoted
    # candidate from being marked 'exported' without ever being written out.
    inv = "aaaabbbbcccc"
    cand_a = _candidate(inv=inv, cand_id=CAND_A)
    cand_b = _candidate(inv=inv, cand_id=CAND_B)
    dataset = [candidate_to_case(cand_a)]  # only A is actually in the dataset

    new_dataset, export_ids = reconcile(dataset, [cand_a, cand_b])
    b_case_id = candidate_to_case(cand_b)["id"]
    assert b_case_id not in {c["id"] for c in dataset}
    # B's case IS appended by reconcile (it's a genuinely new candidate), so
    # it legitimately becomes present and exportable too.
    assert b_case_id in {c["id"] for c in new_dataset}
    assert set(export_ids) == {CAND_A, CAND_B}


def test_reconcile_fresh_candidate_is_appended_and_exported():
    cand = _candidate(inv="aaaabbbbcccc", cand_id=CAND_A)
    new_dataset, export_ids = reconcile([], [cand])
    assert len(new_dataset) == 1
    assert new_dataset[0]["id"] == candidate_to_case(cand)["id"]
    assert export_ids == [CAND_A]
