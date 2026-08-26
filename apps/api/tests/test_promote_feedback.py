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

    # Idempotency is id-collision-based, not content-based: there is no
    # candidate identity to compare against (pure dicts, no DB row id), so
    # re-passing the SAME two candidates a second time is indistinguishable
    # from two brand-new candidates that happen to share identical content —
    # both are legitimately appended as _2/_3, continuing the sequence (see
    # test_append_continues_seq_across_runs_instead_of_colliding). The real
    # no-double-write guarantee comes from main() only ever querying
    # status='promoted' rows: once a candidate is exported it is never
    # re-passed to append_new_cases, so the batch on any later run is
    # necessarily disjoint from what's already in the dataset. An empty
    # batch — what main() actually re-runs with after nothing new has been
    # promoted — is the case that must add nothing:
    out2, added2 = append_new_cases(out, [])
    assert added2 == []
    assert len(out2) == 3


def test_appended_cases_validate_against_dataset_shape():
    # Mirror eval/test_dataset_shape.py's invariants.
    dataset, _ = append_new_cases([], [_candidate()])
    for c in dataset:
        assert c["expected_band"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
        assert "job_text" in c["submission"]
        assert isinstance(json.dumps(c), str)  # JSON-serializable


def test_append_continues_seq_across_runs_instead_of_colliding():
    # A prior (now-exported) promotion already put feedback_<inv[:8]>_0 in the
    # dataset. A later, separate promotion for the SAME investigation must not
    # recompute seq=0 (which would collide with the existing id and be
    # silently skipped, losing the new candidate forever).
    inv = "aaaabbbbcccc"
    dataset = [candidate_to_case(_candidate(inv=inv), seq=0)]
    assert dataset[0]["id"] == "feedback_aaaabbbb_0"

    out, added = append_new_cases(dataset, [_candidate(inv=inv)])
    assert added == ["feedback_aaaabbbb_1"]
    assert len(out) == 2

    # Re-running with no further promotions (main()'s real behavior: the
    # row just promoted is now 'exported', so the DB query no longer returns
    # it) is idempotent — an empty batch never appends anything, regardless
    # of what the dataset already contains.
    out2, added2 = append_new_cases(out, [])
    assert added2 == []
    assert len(out2) == 2
