import pytest
from datetime import datetime, timezone
from app.graph.state import InvestigationState, RawSubmission, Source
from app.graph.nodes import analysis
from app.cost_tracker import NodeUsage


def _src(id_):
    return Source(id=id_, url="https://x", kind="fetched_page",
                  retrieved_at=datetime.now(timezone.utc),
                  content_summary="acme reported for advance fee scam", raw_excerpt="…")


@pytest.mark.asyncio
async def test_analysis_stamps_provenance_and_ids(monkeypatch):
    llm_out = analysis._AnalysisLLM(
        findings=[analysis._LLMFinding(category="company", direction="suspicious",
                    severity="high", claim="Reported advance-fee scam", source_ids=["src_001"])],
        unresolved_questions=["Could not confirm office address"])

    async def fake_call(model, schema, messages, *, node):
        return llm_out, NodeUsage(node=node, model="strong", usd=0.06)
    monkeypatch.setattr(analysis, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"), sources=[_src("src_001")])
    out = await analysis.analysis(state)
    new = [f for f in out["findings"] if f.claim == "Reported advance-fee scam"][0]
    assert new.provenance == "web_verified"
    assert new.id.startswith("an_")
    assert new.source_ids == ["src_001"]
    assert out["unresolved_questions"] == ["Could not confirm office address"]


@pytest.mark.asyncio
async def test_analysis_prompt_puts_evidence_last(monkeypatch):
    captured = {}

    async def fake_call(model, schema, messages, *, node):
        captured["messages"] = messages
        return analysis._AnalysisLLM(findings=[], unresolved_questions=[]), NodeUsage(node=node, model="strong")
    monkeypatch.setattr(analysis, "structured_call", fake_call)
    state = InvestigationState(submission=RawSubmission(job_text="x"), sources=[_src("src_001")])
    await analysis.analysis(state)
    roles = [m[0] for m in captured["messages"]]
    assert roles[0] == "system"                    # static prefix first
    assert "src_001" in captured["messages"][-1][1]  # evidence pack last


@pytest.mark.asyncio
async def test_analysis_prompt_defines_the_severity_scale(monkeypatch):
    # The rubric turns severity into points (info=0 … critical=15), so an
    # unanchored severity is the LLM silently deciding the band. Case
    # CE710EBD: a training-fee demand was self-assigned "low" (1 point) and
    # the report landed on LOW RISK. The system prompt must define what each
    # level means.
    captured = {}

    async def fake_call(model, schema, messages, *, node):
        captured["system"] = messages[0][1]
        return analysis._AnalysisLLM(findings=[], unresolved_questions=[]), \
            NodeUsage(node=node, model="strong")
    monkeypatch.setattr(analysis, "structured_call", fake_call)
    state = InvestigationState(submission=RawSubmission(job_text="x"), sources=[_src("src_001")])
    await analysis.analysis(state)
    system = captured["system"].lower()
    for level in ("info", "low", "medium", "high", "critical"):
        assert level in system, f"severity level {level!r} is undefined in the analysis prompt"


@pytest.mark.asyncio
async def test_analysis_prompt_pins_advance_fee_to_critical(monkeypatch):
    # The single most reliable scam signal must not be left to the model's
    # discretion: an upfront fee demanded from the candidate is `critical`,
    # named explicitly so it can't be graded down to "low".
    captured = {}

    async def fake_call(model, schema, messages, *, node):
        captured["system"] = messages[0][1]
        return analysis._AnalysisLLM(findings=[], unresolved_questions=[]), \
            NodeUsage(node=node, model="strong")
    monkeypatch.setattr(analysis, "structured_call", fake_call)
    state = InvestigationState(submission=RawSubmission(job_text="x"), sources=[_src("src_001")])
    await analysis.analysis(state)
    system = captured["system"].lower()
    assert "fee" in system
    assert "critical" in system


def _posting_src():
    # What evidence_assembly._posting_source builds from the pasted job text:
    # the submitter's own words, canonicalized as a citable source.
    return Source(id="src_det_posting", url=None, kind="user_provided",
                  retrieved_at=datetime.now(timezone.utc),
                  content_summary="Submitted job posting text: pay a $200 training fee",
                  raw_excerpt="pay a $200 training fee")


@pytest.mark.asyncio
async def test_analysis_marks_posting_only_findings_user_provided(monkeypatch):
    # The node stamped provenance="web_verified" on every finding regardless of
    # what it cited. A finding whose only source is the submitter's own pasted
    # posting has verified nothing — labelling it web_verified defeats the §9.1
    # sabotage cap (which fires only when every suspicious finding is
    # user_provided_unverified) and overstates the evidence in the UI.
    llm_out = analysis._AnalysisLLM(findings=[analysis._LLMFinding(
        category="job", direction="suspicious", severity="critical",
        claim="The posting demands a $200 training fee", source_ids=["src_det_posting"])])

    async def fake_call(model, schema, messages, *, node):
        return llm_out, NodeUsage(node=node, model="strong")
    monkeypatch.setattr(analysis, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"), sources=[_posting_src()])
    out = await analysis.analysis(state)
    assert out["findings"][0].provenance == "user_provided_unverified"


@pytest.mark.asyncio
async def test_analysis_keeps_web_verified_when_a_web_source_corroborates(monkeypatch):
    # One independently-retrieved source is enough: the claim is no longer
    # resting on the submitter's word alone.
    llm_out = analysis._AnalysisLLM(findings=[analysis._LLMFinding(
        category="job", direction="suspicious", severity="high",
        claim="Same posting appears under two different companies",
        source_ids=["src_det_posting", "src_001"])])

    async def fake_call(model, schema, messages, *, node):
        return llm_out, NodeUsage(node=node, model="strong")
    monkeypatch.setattr(analysis, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"),
                               sources=[_posting_src(), _src("src_001")])
    out = await analysis.analysis(state)
    assert out["findings"][0].provenance == "web_verified"


@pytest.mark.asyncio
async def test_analysis_does_not_claim_web_verified_for_uncited_findings(monkeypatch):
    # A finding citing nothing (or a hallucinated id) is dropped downstream by
    # the citation validator, but it must not carry web_verified authority in
    # the meantime.
    llm_out = analysis._AnalysisLLM(findings=[
        analysis._LLMFinding(category="job", direction="suspicious", severity="high",
                             claim="uncited", source_ids=[]),
        analysis._LLMFinding(category="job", direction="suspicious", severity="high",
                             claim="hallucinated id", source_ids=["src_999"]),
    ])

    async def fake_call(model, schema, messages, *, node):
        return llm_out, NodeUsage(node=node, model="strong")
    monkeypatch.setattr(analysis, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(job_text="x"), sources=[_src("src_001")])
    out = await analysis.analysis(state)
    assert [f.provenance for f in out["findings"]] == \
        ["user_provided_unverified", "user_provided_unverified"]
