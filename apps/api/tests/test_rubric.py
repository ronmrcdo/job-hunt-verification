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
    # trusted on its own and must not be capped by the soft-only rule. Ownership
    # is confirmed here so the Gap-B precondition (§5/§9.1, task 5.2) doesn't
    # also cap it -- that rule is exercised separately below.
    a = compute_assessment(_state([_f("f1", "high", prov="deterministic")],
                                   signals={"entity_ownership_confirmed": True}))
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


def test_payment_floor_fires_for_fee_stated_in_the_posting():
    # Real-world miss (case CE710EBD): the posting itself demanded a training
    # fee before onboarding. The analysis node filed it under `job` (it came
    # from the posting, not a conversation), so the old
    # category == "communication" gate skipped the floor and the report
    # rendered LOW RISK next to an advance-fee demand. The spec's §5 rule 2
    # assumed advance-fee requests only arrive via conversation paste; they
    # also appear in posting text.
    a = compute_assessment(_state([
        _f("pay", "low", category="job",
           claim="The job posting requires a small training fee before onboarding"),
    ]))
    assert a.band in ("HIGH", "CRITICAL")


def test_payment_floor_ignores_legitimizing_fee_mentions():
    # Guard for the widened category gate: a finding that says the posting
    # does NOT ask for money contains a payment marker but is evidence of
    # legitimacy. Flooring on it would invert the signal.
    a = compute_assessment(_state([
        _f("clean", "info", direction="legitimizing", category="job",
           claim="The posting states no training fee or equipment fee is required"),
    ]))
    assert a.band == "LOW"


def test_payment_floor_ignores_unverifiable_fee_mentions():
    # An `unverifiable` finding contributes 0 to the score by design; it must
    # not trigger the floor either, or "we couldn't confirm whether a fee is
    # charged" would read as "a fee is charged".
    a = compute_assessment(_state([
        _f("unk", "low", direction="unverifiable", category="job",
           claim="We could not confirm whether an onboarding fee is charged"),
    ]))
    assert a.band == "LOW"


def test_posting_only_suspicion_against_a_named_company_caps_at_moderate():
    # Now reachable in V0: with analysis deriving provenance from what a
    # finding cites, suspicion resting solely on the submitter's pasted
    # posting is user_provided_unverified, so the §9.1 sabotage cap applies —
    # pasting a fabricated posting naming a real company can no longer alone
    # produce a HIGH/CRITICAL report about that company.
    a = compute_assessment(_state([
        _f("f1", "high", prov="user_provided_unverified", category="job"),
        _f("f2", "high", prov="user_provided_unverified", category="company"),
    ], company="Acme"))
    assert a.band == "MODERATE"


def test_payment_floor_outranks_the_sabotage_cap():
    # Deliberate spec ordering (§5 rule 2): the floor describes "the
    # opportunity as presented to this user", so an advance-fee demand in the
    # submitted posting still floors at HIGH. The report's provenance label
    # carries the "we can't verify this" caveat instead of the band hiding it.
    a = compute_assessment(_state([
        _f("pay", "critical", prov="user_provided_unverified", category="job",
           claim="The posting requires a $200 training fee before onboarding"),
    ], company="Acme"))
    assert a.band == "HIGH"


def test_web_verified_lookalike_login_floors_high():
    # spec §5/S5: a web-verified finding that the posting asks the candidate to
    # log in on a credential-lookalike domain floors the band at HIGH, even if
    # the rest of the score alone wouldn't reach it.
    f = Finding(id="l", category="communication", direction="suspicious", severity="high",
                claim="The posting asks you to log in on a lookalike of the company's verified domain (x).",
                provenance="web_verified", user_safety_alert=True, source_ids=["src_001"])
    a = compute_assessment(_state([f]))
    assert a.band in ("HIGH", "CRITICAL")


def test_user_provided_lookalike_login_capped_moderate_for_named_company():
    # Same claim shape but user_provided_unverified: the credential-lookalike
    # floor must NOT fire here -- only the §9.1 unverified cap applies, so a
    # named company stays capped at MODERATE.
    f = Finding(id="l", category="communication", direction="suspicious", severity="high",
                claim="The posting asks you to log in on a lookalike ... (x).",
                provenance="user_provided_unverified", user_safety_alert=True, source_ids=["src_001"])
    a = compute_assessment(_state([f]))
    assert a.band == "MODERATE"


def test_high_severity_deterministic_capped_for_named_company_when_unconfirmed():
    # Gap B (spec §5/§9.1): a deterministic signal computed on a
    # user-supplied entity (domain/email) cannot move a NAMED company's band
    # past MODERATE until disambiguation (§7) confirms the entity belongs to
    # that company. Without confirmation, a saboteur's throwaway domain must
    # not defame a real employer.
    f = Finding(id="det_homoglyph", category="domain", direction="suspicious", severity="high",
                claim="The contact domain is a lookalike of the company's real domain.",
                provenance="deterministic", source_ids=["src_det_domain"])
    a = compute_assessment(_state([f], signals={"entity_ownership_confirmed": False}))
    assert a.band == "MODERATE"


def test_credential_floor_fires_from_real_scan_links_output():
    # I2: drive the credential-lookalike floor from the REAL `scan_links(...)`
    # output rather than a hand-written claim string, so the floor can't
    # silently stop firing if the scanner's claim wording changes. A
    # web_verified lookalike login (canonical_verified=True + a homoglyph host)
    # must floor a named, ownership-unconfirmed company at HIGH.
    from app.checks.link_scan import scan_links
    findings = scan_links(
        "Please log in to continue: https://acme-globall.com/login to verify your account.",
        provenance="web_verified", canonical_domain="acme-global.com",
        canonical_verified=True, id_prefix="linkscan_fetched",
        source_ids=["src_det_fetched"])
    assert any(f.user_safety_alert and "lookalike" in f.claim.lower() and "log in" in f.claim.lower()
               for f in findings), f"scan_links did not emit a lookalike login finding: {findings}"
    a = compute_assessment(_state(findings, company="Acme Global"))
    assert a.band in ("HIGH", "CRITICAL")


def test_high_severity_deterministic_uncapped_when_ownership_confirmed():
    f = Finding(id="det_homoglyph", category="domain", direction="suspicious", severity="high",
                claim="lookalike ...", provenance="deterministic", source_ids=["src_det_domain"])
    a = compute_assessment(_state([f], signals={"entity_ownership_confirmed": True}))
    assert a.band in ("HIGH", "CRITICAL")


def test_f2_mixed_provenance_sabotage_capped_at_moderate():
    # F2/C2 joint-bypass regression: a real company_name + throwaway new domain
    # (LOW deterministic finding) + pasted off-domain login link (HIGH
    # user_provided_unverified). The LOW deterministic finding broke the old
    # "all-upv" cap; being LOW it escaped the old high-severity deterministic
    # gate — so neither old cap fired and the named company banded HIGH from
    # pure attacker input. The unified cap must hold it at MODERATE: no
    # web_verified suspicious finding is present.
    det_new_domain = _f("det_new_domain", "low", prov="deterministic", category="domain",
                        claim="Company domain was registered 3 days ago (very recent).")
    upv_login = _f("linkscan_paste_0", "high", prov="user_provided_unverified",
                   category="communication",
                   claim="The posting asks you to log in on a site that is not the "
                         "company's own domain (x).")
    a = compute_assessment(_state([det_new_domain, upv_login], company="Acme"))
    assert a.band == "MODERATE"


def test_web_verified_high_suspicious_on_named_unconfirmed_company_not_capped():
    # The unified cap must NOT muzzle a genuine web-verified suspicious finding:
    # a named, ownership-unconfirmed company can still reach HIGH when the
    # suspicion is web_verified (independently fetched), not attacker-supplied.
    a = compute_assessment(_state([
        _f("wv1", "high", prov="web_verified", category="job"),
        _f("wv2", "medium", prov="web_verified", category="company"),
        _f("wv3", "medium", prov="web_verified", category="domain"),
    ], company="Acme"))
    assert a.band in ("HIGH", "CRITICAL")
