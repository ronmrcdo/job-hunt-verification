import pytest
from app.graph.state import InvestigationState, RawSubmission, FinalAssessment, Finding
from app.graph.nodes import language_linter as ll
from app.security.defang import contains_accusation
from app.cost_tracker import NodeUsage

def _state(summary, findings=None):
    return InvestigationState(submission=RawSubmission(job_text="x"),
        assessment=FinalAssessment(band="HIGH", confidence="LOW", summary=summary, coverage=0.2),
        findings=findings or [])

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


@pytest.mark.asyncio
async def test_finding_claim_with_accusation_is_neutralized(monkeypatch):
    called = {"n": 0}
    async def fake_call(*a, **k):
        called["n"] += 1
        return None, NodeUsage(node="x", model="cheap")
    monkeypatch.setattr(ll, "structured_call", fake_call)
    f = Finding(id="f1", category="company", direction="suspicious", severity="critical",
                claim="Acme is a scam", source_ids=["src_001"], provenance="web_verified")
    out = await ll.language_linter(_state("We found 2 signals consistent with scam patterns.",
                                           findings=[f]))
    # Clean summary -> no regen call needed.
    assert called["n"] == 0
    scrubbed = out["findings"][0]
    assert contains_accusation(scrubbed.claim) is False
    # Severity/direction/source_ids preserved -- only the claim text changes.
    assert scrubbed.severity == "critical"
    assert scrubbed.direction == "suspicious"
    assert scrubbed.source_ids == ["src_001"]


@pytest.mark.asyncio
async def test_regenerated_summary_with_raw_url_is_defanged(monkeypatch):
    # The LLM regen path (contains_accusation gate trips) can introduce a
    # fresh raw URL in its rewrite; that must still come out defanged
    # (spec §9.5) rather than skipping the final defang pass.
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="Signals consistent with scam patterns, see https://evil.example/apply"), \
               NodeUsage(node=node, model="cheap")
    monkeypatch.setattr(ll, "structured_call", fake_call)
    out = await ll.language_linter(_state("Acme Global is a scam and will defraud you."))
    summary = out["assessment"].summary
    assert "https://evil.example" not in summary
    assert "hxxps://evil[.]example" in summary


@pytest.mark.asyncio
async def test_clean_finding_claim_untouched(monkeypatch):
    async def fake_call(*a, **k):
        return None, NodeUsage(node="x", model="cheap")
    monkeypatch.setattr(ll, "structured_call", fake_call)
    f = Finding(id="f1", category="company", direction="suspicious", severity="medium",
                claim="The domain was registered 3 days ago", source_ids=["src_001"],
                provenance="deterministic")
    out = await ll.language_linter(_state("We found 2 signals consistent with scam patterns.",
                                           findings=[f]))
    assert out["findings"][0].claim == "The domain was registered 3 days ago"
