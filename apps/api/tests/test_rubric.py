from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities, Finding
from app.rubric import compute_assessment, score_findings, PAYMENT_MARKERS


def _f(id_, sev, direction="suspicious", prov="web_verified", category="company", claim="c"):
    return Finding(id=id_, category=category, direction=direction, severity=sev, claim=claim,
                   source_ids=["src_001"], provenance=prov)


def _state(findings, signals=None, company="Acme"):
    return InvestigationState(
        submission=RawSubmission(job_text="x", company_name=company),
        entities=ExtractedEntities(company_name=company),
        findings=findings, deterministic_signals=signals or {})


def test_clean_job_is_low():
    a = compute_assessment(_state([_f("f1", "info", "legitimizing")]))
    assert a.band == "LOW"


def test_single_soft_signal_capped_at_moderate():
    # one high suspicious web finding alone would score HIGH, but the one-band rule caps it
    a = compute_assessment(_state([_f("f1", "high")]))
    assert a.band == "MODERATE"


def test_multiple_signals_compound_past_moderate():
    a = compute_assessment(_state([_f("f1", "high"), _f("f2", "medium", category="domain"),
                                   _f("f3", "medium", category="recruiter")]))
    assert a.band in ("HIGH", "CRITICAL")


def test_payment_floor_forces_high():
    a = compute_assessment(_state([_f("pay", "low", category="communication",
                                      claim="Recruiter requested a $200 onboarding fee")]))
    assert a.band in ("HIGH", "CRITICAL")


def test_user_provided_only_capped_at_moderate_for_named_company():
    a = compute_assessment(_state([_f("u1", "critical", prov="user_provided_unverified")]))
    assert a.band == "MODERATE"


def test_confidence_tracks_coverage():
    low_cov = compute_assessment(_state([_f("f1", "low")]))
    assert low_cov.confidence in ("LOW", "MODERATE")
    wide = compute_assessment(_state([
        _f("f1", "low", category="company"), _f("f2", "low", category="domain"),
        _f("f3", "low", category="recruiter"), _f("f4", "low", category="job"),
        _f("f5", "low", category="cross_source"), _f("f6", "low", category="communication")]))
    assert wide.confidence == "HIGH"
    assert 0.0 <= wide.coverage <= 1.0


# --- Additional rule-specific tests ---

def test_bands_only_no_numeric_verdict_exposed():
    # Rule 5: output is band + confidence label only, never a raw score.
    a = compute_assessment(_state([_f("f1", "high")]))
    assert a.band in ("LOW", "MODERATE", "HIGH", "CRITICAL")
    assert a.confidence in ("LOW", "MODERATE", "HIGH")
    assert not hasattr(a, "score")
    # coverage is a 0..1 fraction (evidence coverage), not a suspicion percentage/verdict
    assert 0.0 <= a.coverage <= 1.0


def test_injection_finding_scores_as_high_severity():
    # Rule 6: an injection-attempt finding (category=job, direction=suspicious) contributes
    # at HIGH severity. Compare score with a "low" severity finding of the same shape.
    injection = _f("inj", "high", category="job", claim="prompt injection attempt detected")
    low_equivalent = _f("inj2", "low", category="job", claim="prompt injection attempt detected")
    assert score_findings([injection], {}) > score_findings([low_equivalent], {})
    assert score_findings([injection], {}) == score_findings(
        [_f("x", "high", category="job")], {}
    )


def test_staffing_agency_reframe_caps_recruiter_and_job_findings():
    # Rule 7: when recruiter_is_ats (agency) signal is set, email-mismatch (recruiter) and
    # job-not-on-careers-page (job) findings are capped in contribution (x0.5).
    findings = [_f("f1", "high", category="recruiter"), _f("f2", "high", category="job")]
    normal_score = score_findings(findings, {})
    agency_score = score_findings(findings, {"recruiter_is_ats": True})
    assert agency_score == normal_score / 2

    # And a job that would otherwise land HIGH/CRITICAL is reduced under the agency reframe.
    a_normal = compute_assessment(_state(findings))
    a_agency = compute_assessment(_state(findings, signals={"recruiter_is_ats": True}))
    from app.rubric import _BANDS
    assert _BANDS.index(a_agency.band) <= _BANDS.index(a_normal.band)


def test_payment_markers_frozenset_exported():
    assert isinstance(PAYMENT_MARKERS, frozenset)
    assert "fee" in PAYMENT_MARKERS or "wire" in PAYMENT_MARKERS
