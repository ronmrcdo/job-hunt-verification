import pytest
from app.graph.state import InvestigationState, RawSubmission, FinalAssessment
from app.graph.nodes import language_linter as ll
from app.cost_tracker import NodeUsage

def _state(summary):
    return InvestigationState(submission=RawSubmission(job_text="x"),
        assessment=FinalAssessment(band="HIGH", confidence="LOW", summary=summary, coverage=0.2))

@pytest.mark.asyncio
async def test_clean_summary_untouched(monkeypatch):
    called = {"n": 0}
    async def fake_call(*a, **k):
        called["n"] += 1
        return None, NodeUsage(node="x", model="cheap")
    monkeypatch.setattr(ll, "structured_call", fake_call)
    out = await ll.language_linter(_state("We found 2 signals consistent with scam patterns."))
    assert called["n"] == 0
    assert "consistent with" in out["assessment"].summary

@pytest.mark.asyncio
async def test_accusation_regenerated_once(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found signals consistent with known scam patterns."), \
               NodeUsage(node=node, model="cheap", usd=0.002)
    monkeypatch.setattr(ll, "structured_call", fake_call)
    out = await ll.language_linter(_state("Acme Global is a scam and will defraud you."))
    assert "is a scam" not in out["assessment"].summary.lower()

@pytest.mark.asyncio
async def test_persistent_accusation_neutralized_deterministically(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="It is fraudulent."), NodeUsage(node=node, model="cheap")
    monkeypatch.setattr(ll, "structured_call", fake_call)
    out = await ll.language_linter(_state("Acme is a scam."))
    assert "fraudulent" not in out["assessment"].summary.lower()
    assert "signals" in out["assessment"].summary.lower()  # safe template
