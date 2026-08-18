from app.graph.state import InvestigationState, RawSubmission, Finding
from app.graph.nodes.banding import risk_banding


def test_banding_sets_assessment():
    state = InvestigationState(submission=RawSubmission(job_text="x"),
        findings=[Finding(id="f1", category="company", direction="legitimizing",
                          severity="info", claim="ok", source_ids=["src_001"],
                          provenance="web_verified")])
    out = risk_banding(state)
    assert out["assessment"].band == "LOW"
