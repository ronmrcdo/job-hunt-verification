from datetime import datetime, timezone
from app.graph.state import (
    RawSubmission, ExtractedEntities, Source, Finding, FinalAssessment, InvestigationState)

def test_finding_requires_source_ids_field():
    f = Finding(id="f1", category="company", direction="suspicious", severity="high",
                claim="No web presence", source_ids=["src_001"],
                provenance="web_verified", mitigation=None)
    assert f.source_ids == ["src_001"]

def test_submission_is_present_and_typed():
    s = InvestigationState(
        submission=RawSubmission(job_text="We are hiring", company_name="Acme",
                                 recruiter_email="jo@acme.com", job_url=None),
        entities=ExtractedEntities(),
        sources=[], deterministic_signals={}, findings=[],
        unresolved_questions=[], research_attempts=0, cost_events=[], assessment=None)
    assert s.submission.job_text == "We are hiring"
    assert s.research_attempts == 0

def test_final_assessment_band_literal():
    a = FinalAssessment(band="MODERATE", confidence="LOW", summary="…", coverage=0.33)
    assert a.band == "MODERATE"
