import pytest
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


def test_two_soft_findings_alone_cannot_reach_critical():
    # Devil's advocate finding #4: two soft (web_verified) suspicious findings
    # with zero deterministic corroboration and no payment floor used to drive
    # the band straight to CRITICAL off the analysis LLM's severity labels
    # alone. The generalized FP defense caps soft-only suspicion at HIGH.
    a = compute_assessment(_state([
        _f("f1", "critical", category="company"),
        _f("f2", "high", category="domain"),
    ]))
    assert a.band != "CRITICAL"
    assert a.band in ("MODERATE", "HIGH")


def test_deterministic_signal_still_reaches_high():
    # A deterministic-provenance suspicious finding (e.g. homoglyph hit) is
    # trusted on its own and must not be capped by the soft-only rule.
    a = compute_assessment(_state([_f("f1", "high", prov="deterministic")]))
    assert a.band == "HIGH"


def test_payment_floor_still_high_with_soft_findings():
    # Payment floor must still force HIGH even alongside soft findings.
    a = compute_assessment(_state([
        _f("f1", "critical", category="company"),
        _f("pay", "low", category="communication",
           claim="Recruiter requested a $200 onboarding fee"),
    ]))
    assert a.band in ("HIGH", "CRITICAL")


def test_payment_markers_frozenset_exported():
    assert isinstance(PAYMENT_MARKERS, frozenset)
    assert "fee" in PAYMENT_MARKERS or "wire" in PAYMENT_MARKERS


def test_all_timed_out_branches_yield_low_confidence_not_high():
    # Rule 4 (§5): "Timed-out branches lower coverage, which lowers
    # confidence — degradation is automatic." A fully-timed-out investigation
    # (every category only has a synthetic "unverifiable" finding, the shape
    # graph/build.py's branch-timeout wrapper emits) must NOT read as HIGH
    # confidence just because every category technically has a source-backed
    # finding.
    timeouts = [
        _f("t1", "info", direction="unverifiable", prov="deterministic", category=cat,
           claim=f"{cat} did not complete within the time budget — treat as unverifiable.")
        for cat in ("company", "job", "recruiter", "domain", "communication", "cross_source")
    ]
    a = compute_assessment(_state(timeouts))
    assert a.coverage == 0.0
    assert a.confidence == "LOW"


def test_genuinely_covered_case_still_gets_its_confidence():
    # A real (non-unverifiable) source-backed finding in every category
    # still drives confidence up as before.
    wide = [_f(f"f{i}", "low", category=cat)
            for i, cat in enumerate(("company", "domain", "recruiter", "job",
                                      "cross_source", "communication"))]
    a = compute_assessment(_state(wide))
    assert a.coverage == 1.0
    assert a.confidence == "HIGH"


def test_mixed_timeout_and_real_coverage_only_counts_real():
    # One real, source-backed finding plus five timed-out ("unverifiable")
    # categories should read as low coverage, not near-full.
    findings = [_f("real", "low", category="company")] + [
        _f(f"t{i}", "info", direction="unverifiable", prov="deterministic", category=cat)
        for i, cat in enumerate(("job", "recruiter", "domain", "communication", "cross_source"))
    ]
    a = compute_assessment(_state(findings))
    assert a.coverage == pytest.approx(1 / 6, abs=0.001)  # rounded to 3 decimals
    assert a.confidence == "LOW"
