from datetime import datetime, timezone
from app.graph.state import InvestigationState, RawSubmission, Source, Finding
from app.graph.nodes.citation import citation_validator

def _src(id_, summary):
    return Source(id=id_, url="https://x", kind="fetched_page",
                  retrieved_at=datetime.now(timezone.utc), content_summary=summary, raw_excerpt=summary)

def _f(id_, ids, claim, prov="web_verified"):
    return Finding(id=id_, category="company", direction="suspicious", severity="medium",
                   claim=claim, source_ids=ids, provenance=prov)

def test_drops_finding_citing_nonexistent_source():
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        sources=[_src("src_001", "acme is a saas company")],
        findings=[_f("f1", ["src_999"], "acme is fraudulent")])
    out = citation_validator(state)
    assert out["findings"] == []
    assert out["deterministic_signals"]["citation_drops"] == 1

def test_keeps_grounded_finding():
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        sources=[_src("src_001", "multiple users report an advance fee scam at acme")],
        findings=[_f("f1", ["src_001"], "Users report an advance fee scam")])
    out = citation_validator(state)
    assert len(out["findings"]) == 1
    assert out["deterministic_signals"]["citation_drops"] == 0

def test_deterministic_finding_exempt_from_token_grounding():
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        sources=[_src("src_det_domain", "domain_age_days=3 homoglyph_hit=True")],
        findings=[_f("f1", ["src_det_domain"], "The contact domain is a lookalike.",
                     prov="deterministic")])
    out = citation_validator(state)
    assert len(out["findings"]) == 1

def test_drops_web_verified_finding_with_no_token_overlap():
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        sources=[_src("src_001", "acme is a legitimate saas company based in denver")],
        findings=[_f("f1", ["src_001"], "The recruiter demanded payment via gift cards")])
    out = citation_validator(state)
    assert out["findings"] == []
    assert out["deterministic_signals"]["citation_drops"] == 1

def test_drops_user_provided_unverified_finding_with_no_token_overlap():
    # user_provided_unverified findings are NOT exempt from the token check —
    # only deterministic-provenance findings are (they cite synthetic sources).
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        sources=[_src("src_001", "the recruiter asked me to buy a laptop with my own money")],
        findings=[_f("f1", ["src_001"], "The company offers a competitive salary",
                     prov="user_provided_unverified")])
    out = citation_validator(state)
    assert out["findings"] == []
    assert out["deterministic_signals"]["citation_drops"] == 1

def test_citation_drops_merges_into_existing_signals():
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        sources=[],
        deterministic_signals={"domain_age_days": 3},
        findings=[_f("f1", ["src_999"], "acme is fraudulent")])
    out = citation_validator(state)
    assert out["deterministic_signals"] == {"domain_age_days": 3, "citation_drops": 1}
