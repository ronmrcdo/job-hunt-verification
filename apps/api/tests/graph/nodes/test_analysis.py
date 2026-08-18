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
