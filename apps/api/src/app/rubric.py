"""Deterministic risk-banding rubric.

Pure function: findings + deterministic signals -> band + confidence + coverage.
No LLM or network involvement. Encodes every §5 rule as code:

1. One-band rule: a single soft (non-deterministic-provenance) suspicious finding
   cannot move the result past MODERATE.
2. Payment-floor: a communication finding naming a payment/fee marker floors the
   band at HIGH.
3. user_provided_unverified cap: if the only suspicious findings are user-provided
   and unverified, a named company cannot be pushed past MODERATE (spec §9.1
   sabotage defense).
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


def _is_payment_finding(f: Finding) -> bool:
    return f.category == "communication" and any(m in f.claim.lower() for m in PAYMENT_MARKERS)


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
    or deterministic finding. This is the sole driver of confidence -- the LLM
    never self-reports confidence (rule 4)."""
    covered = {f.category for f in findings if f.source_ids}
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
    if len(suspicious) == 1 and len(soft_suspicious) == 1:
        band = _cap(band, "MODERATE")

    # Rule: user_provided_unverified findings alone cannot push a NAMED company
    # past MODERATE (spec §9.1 sabotage defense: a candidate can't get their own
    # honest employer scored CRITICAL just by asserting scam claims).
    if suspicious and all(f.provenance == "user_provided_unverified" for f in suspicious) \
            and state.entities.company_name:
        band = _cap(band, "MODERATE")

    # Rule: payment/fee request in a communication finding floors the band at
    # HIGH, regardless of what the rest of the score says. Dormant in V0 (no V0
    # input path produces a communication finding) but built and covered by a
    # synthetic test.
    if any(_is_payment_finding(f) for f in findings):
        band = _floor(band, "HIGH")

    coverage = _coverage(findings)
    return FinalAssessment(band=band, confidence=_confidence(coverage),
                           summary="", coverage=round(coverage, 3))
