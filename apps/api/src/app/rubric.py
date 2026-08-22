"""Deterministic risk-banding rubric.

Pure function: findings + deterministic signals -> band + confidence + coverage.
No LLM or network involvement. Encodes every §5 rule as code:

1. One-band rule: a single soft (non-deterministic-provenance) suspicious finding
   cannot move the result past MODERATE.
2. Payment-floor: a suspicious communication *or* job finding naming a
   payment/fee marker floors the band at HIGH.
3. Named-company sabotage cap (spec §9.1/§5 Gap B, unified): for a named company
   whose ownership of the submitted entity is unconfirmed, only a web_verified
   suspicious finding may breach MODERATE — deterministic signals on the
   user-supplied entity and user_provided_unverified findings (both attacker-
   controlled) cannot. The payment/credential floors still override to HIGH.
4. Confidence = coverage: confidence is derived from the fraction of entity
   categories with >=1 source-backed finding, never self-reported by the LLM.
5. Bands only: the public output is Band + Confidence + summary; no percentage or
   raw score is exposed as a verdict.
6. Injection-as-finding: an injection-attempt finding is scored at "high" severity
   by whoever produces it (Phase 5); this module just scores it like any other
   high-severity finding.
7. Staffing-agency reframe: when the recruiter domain looks like a plausible
   agency, "job not on careers page" and "email domain mismatch" findings have
   their point contribution capped (x0.5) since agencies are the #1
   false-positive source.
"""
from app.graph.state import InvestigationState, Finding, FinalAssessment, Band, Confidence

_POINTS = {"info": 0, "low": 1, "medium": 3, "high": 7, "critical": 15}
_BANDS: list[Band] = ["LOW", "MODERATE", "HIGH", "CRITICAL"]
_CATEGORIES = ["company", "job", "recruiter", "domain", "communication", "cross_source"]
# Categories reframed/capped under the staffing-agency rule (§5 rule 7).
_AGENCY_REFRAMED_CATEGORIES = ("recruiter", "job")

PAYMENT_MARKERS = frozenset({"fee", "payment", "deposit", "onboarding fee", "processing fee",
                             "wire", "gift card", "pay for", "training fee", "equipment fee"})


def _agency_reframe_active(signals: dict) -> bool:
    # recruiter_is_ats and homoglyph_hit default to False (not None) when their
    # input domain is absent (carried in from Task 1.6); a plain truthy check
    # handles that correctly with no special-casing needed here.
    return bool(signals.get("recruiter_is_ats")) or bool(signals.get("agency_domain"))


# Categories whose findings can carry an advance-fee demand. `communication`
# is the conversation-paste path the spec anticipated; `job` is the posting
# itself, which states the fee outright often enough that gating on
# `communication` alone let a training-fee demand render as LOW RISK.
_PAYMENT_CATEGORIES = ("communication", "job")


def _is_payment_finding(f: Finding) -> bool:
    # `direction` matters: the markers are substrings, so a legitimizing
    # finding ("no training fee is required") or an unverifiable one ("we
    # could not confirm whether a fee is charged") both contain a marker while
    # being the opposite of, or silent on, the signal the floor exists for.
    return (f.direction == "suspicious"
            and f.category in _PAYMENT_CATEGORIES
            and any(m in f.claim.lower() for m in PAYMENT_MARKERS))


CREDENTIAL_LOOKALIKE_MARKERS = ("lookalike", )


def _is_credential_lookalike_floor(f: Finding) -> bool:
    # Floor only for a *verified*-reference lookalike login ask (spec §5/S5).
    # user_provided_unverified lookalikes are handled by the §9.1 cap above,
    # never the floor.
    return (f.provenance == "web_verified"
            and f.user_safety_alert
            and f.direction == "suspicious"
            and "log in" in f.claim.lower()
            and any(m in f.claim.lower() for m in CREDENTIAL_LOOKALIKE_MARKERS))


def score_findings(findings: list[Finding], signals: dict) -> float:
    """Total suspicion score. Deterministic; no LLM self-reporting.

    Severity -> points per the brief's scale. `legitimizing` findings subtract
    half their severity's points (floored at 0 total). `unverifiable` findings
    add 0 -- they lower coverage, not raise the score. The staffing-agency
    reframe (rule 7) halves the contribution of recruiter/job findings when an
    agency signal is present.
    """
    total = 0.0
    agency = _agency_reframe_active(signals)
    for f in findings:
        pts = _POINTS[f.severity]
        if f.direction == "legitimizing":
            total -= pts / 2
        elif f.direction == "suspicious":
            if agency and f.category in _AGENCY_REFRAMED_CATEGORIES:
                pts *= 0.5
            total += pts
        # direction == "unverifiable" contributes 0 to the score.
    return max(total, 0.0)


def _band_for_score(s: float) -> Band:
    if s <= 1:
        return "LOW"
    if s <= 6:
        return "MODERATE"
    if s <= 14:
        return "HIGH"
    return "CRITICAL"


def _cap(band: Band, ceiling: Band) -> Band:
    return _BANDS[min(_BANDS.index(band), _BANDS.index(ceiling))]


def _floor(band: Band, floor: Band) -> Band:
    return _BANDS[max(_BANDS.index(band), _BANDS.index(floor))]


def _coverage(findings: list[Finding]) -> float:
    """Fraction of the six entity-dimension categories with >=1 source-backed
    finding that actually verified something. This is the sole driver of
    confidence -- the LLM never self-reports confidence (rule 4).

    `unverifiable`-direction findings are excluded: a branch timeout (or any
    other degrade-to-unverifiable path, see graph/build.py's branch-timeout
    wrapper) still emits a source-backed synthetic finding so citation
    validation doesn't drop it, but it verified nothing about that category.
    Counting it toward coverage would let a fully-timed-out investigation
    still read as HIGH confidence, which is exactly what spec §5 rule 4
    ("timed-out branches lower coverage, which lowers confidence") rules
    out."""
    covered = {f.category for f in findings if f.source_ids and f.direction != "unverifiable"}
    return len(covered & set(_CATEGORIES)) / len(_CATEGORIES)


def _confidence(coverage: float) -> Confidence:
    if coverage >= 0.66:
        return "HIGH"
    if coverage >= 0.33:
        return "MODERATE"
    return "LOW"


def compute_assessment(state: InvestigationState) -> FinalAssessment:
    findings, signals = state.findings, state.deterministic_signals
    suspicious = [f for f in findings if f.direction == "suspicious"]
    band = _band_for_score(score_findings(findings, signals))

    # Rule: no single soft signal moves the result more than one band. "Soft"
    # here means non-deterministic provenance (web_verified or
    # user_provided_unverified) -- a deterministic signal (e.g. WHOIS lookup)
    # is trusted on its own and is not capped by this rule.
    soft_suspicious = [f for f in suspicious if f.provenance != "deterministic"]
    deterministic_suspicious = [f for f in suspicious if f.provenance == "deterministic"]
    if len(suspicious) == 1 and len(soft_suspicious) == 1:
        band = _cap(band, "MODERATE")

    # Rule (generalized FP defense, devil's advocate finding #4): the original
    # one-band cap above only fires for the single-finding case. With two or
    # more soft (web_verified / user_provided) suspicious findings, the
    # analysis LLM's self-assigned severities + count alone could still drive
    # the band to HIGH or CRITICAL with zero deterministic corroboration --
    # defeating the FP-defense intent of §5/§1.1 ("the LLM never decides the
    # band alone"). Soft-only suspicion (no deterministic-provenance
    # suspicious finding, no payment-floor trigger) is capped at HIGH:
    # reaching CRITICAL requires a deterministic corroborator or the payment
    # floor below.
    payment_floor_triggered = any(_is_payment_finding(f) for f in findings)
    if band == "CRITICAL" and not deterministic_suspicious and not payment_floor_triggered:
        band = _cap(band, "HIGH")

    # Unified named-company sabotage cap (spec §9.1/§5 Gap B). Subsumes the two
    # former caps (the all-user_provided_unverified cap and the high-severity
    # deterministic Gap-B cap), which had a joint bypass: a saboteur pairing a
    # real company_name with a throwaway domain (LOW deterministic finding) and
    # a pasted off-domain login link (HIGH user_provided_unverified) broke the
    # "all-upv" condition AND escaped the high-severity deterministic gate, so
    # neither old cap fired and a named company got banded HIGH from pure
    # attacker input. Rule: for a NAMED company whose ownership of the submitted
    # entity is not yet confirmed, only a WEB-VERIFIED suspicious finding may
    # breach MODERATE. Deterministic signals on the user-supplied entity and
    # user_provided_unverified findings cannot — a saboteur controls both. The
    # payment/credential floors below still apply and can raise to HIGH.
    ownership_confirmed = bool(signals.get("entity_ownership_confirmed"))
    if state.entities.company_name and not ownership_confirmed:
        trusted = any(f.direction == "suspicious" and f.provenance == "web_verified"
                      for f in findings)
        if not trusted:
            band = _cap(band, "MODERATE")

    # Rule: a suspicious payment/fee request floors the band at HIGH,
    # regardless of what the rest of the score says. Reachable in V0 via a
    # `job`-category finding (the posting demands the fee directly); the
    # `communication` path activates with conversation paste in V1.
    if any(_is_payment_finding(f) for f in findings):
        band = _floor(band, "HIGH")

    # Rule (spec §5/S5): a web-verified finding that the posting directs the
    # candidate to log in on a credential-lookalike of the company's real
    # domain floors the band at HIGH. Verified-only by design: a
    # user_provided_unverified lookalike claim is left to the §9.1 cap above
    # instead, so a candidate can't sabotage-float a named employer to HIGH
    # just by asserting one.
    if any(_is_credential_lookalike_floor(f) for f in findings):
        band = _floor(band, "HIGH")

    coverage = _coverage(findings)
    return FinalAssessment(band=band, confidence=_confidence(coverage),
                           summary="", coverage=round(coverage, 3))
