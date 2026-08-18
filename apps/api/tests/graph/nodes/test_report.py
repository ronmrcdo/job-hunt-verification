import pytest
from app.graph.state import InvestigationState, RawSubmission, FinalAssessment, Finding
from app.graph.nodes import report
from app.cost_tracker import NodeUsage


def _state(band="MODERATE", **overrides):
    defaults = dict(
        submission=RawSubmission(job_text="x"),
        assessment=FinalAssessment(band=band, confidence="LOW", summary="", coverage=0.2),
        findings=[Finding(id="f1", category="job", direction="suspicious", severity="low",
                           claim="c", source_ids=["src_001"], provenance="web_verified")],
    )
    defaults.update(overrides)
    return InvestigationState(**defaults)


@pytest.mark.asyncio
async def test_report_fills_summary(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found 2 signals consistent with known scam patterns.",
                      what_to_verify=["Confirm the recruiter's email on the company's careers page."]), \
               NodeUsage(node=node, model="cheap", usd=0.003)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state()
    out = await report.report_generation(state)
    assert "signals consistent" in out["assessment"].summary
    assert out["deterministic_signals"]["what_to_verify"]


@pytest.mark.asyncio
async def test_report_preserves_existing_deterministic_signals(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found 1 signal consistent with known scam patterns.",
                      what_to_verify=["Verify the domain."]), \
               NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state(deterministic_signals={"domain_age_days": 3})
    out = await report.report_generation(state)
    assert out["deterministic_signals"]["domain_age_days"] == 3
    assert out["deterministic_signals"]["what_to_verify"] == ["Verify the domain."]


@pytest.mark.asyncio
async def test_report_uses_cheap_tier(monkeypatch):
    captured = {}

    async def fake_call(model, schema, messages, *, node):
        captured["model"] = model
        return schema(summary="We found 0 signals consistent with known scam patterns.",
                      what_to_verify=["Never pay any fee."]), \
               NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(report, "structured_call", fake_call)
    monkeypatch.setattr(report, "cheap_model", lambda: "CHEAP_SENTINEL")
    state = _state()
    await report.report_generation(state)
    assert captured["model"] == "CHEAP_SENTINEL"


@pytest.mark.asyncio
async def test_report_returns_cost_events(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found 0 signals consistent with known scam patterns.",
                      what_to_verify=["Never pay any fee."]), \
               NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state()
    out = await report.report_generation(state)
    assert out["cost_events"] == [NodeUsage(node="report", model="cheap", usd=0.001)]


@pytest.mark.asyncio
async def test_report_defangs_urls_in_llm_output(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(
            summary="We found signals consistent with known scam patterns; see https://evil-example.com/job for details.",
            what_to_verify=["Confirm https://evil-example.com/job on the company's official careers page."],
        ), NodeUsage(node=node, model="cheap", usd=0.002)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state()
    out = await report.report_generation(state)
    assert "https://evil-example.com" not in out["assessment"].summary
    assert "hxxps://evil-example[.]com" in out["assessment"].summary
    assert all("https://evil-example.com" not in item
               for item in out["deterministic_signals"]["what_to_verify"])


@pytest.mark.asyncio
async def test_report_defangs_mixed_case_scheme_in_llm_output(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(
            summary="We found signals consistent with known scam patterns; see "
                     "HTTPS://Evil-Example.COM/pay for details.",
            what_to_verify=["Confirm Http://Evil.com/x on the company's official careers page."],
        ), NodeUsage(node=node, model="cheap", usd=0.002)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state()
    out = await report.report_generation(state)
    summary = out["assessment"].summary
    checklist = out["deterministic_signals"]["what_to_verify"]
    assert "https://" not in summary.lower()
    assert "http://" not in summary.lower()
    assert "hxxps://evil-example[.]com" in summary.lower()
    assert all("https://" not in item.lower() and "http://" not in item.lower()
               for item in checklist)
    assert any("hxxp://evil[.]com" in item.lower() for item in checklist)


@pytest.mark.asyncio
async def test_report_defangs_urls_in_finding_claims(monkeypatch):
    # Devil's advocate finding #7: finding.claim URLs were never defanged
    # before reaching the response.
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found signals consistent with known scam patterns.",
                      what_to_verify=["Verify the domain."]), \
               NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state(findings=[Finding(
        id="f1", category="job", direction="suspicious", severity="low",
        claim="Apply via https://EVIL.com/apply instead of the official site.",
        source_ids=["src_001"], provenance="web_verified")])
    out = await report.report_generation(state)
    claim = out["findings"][0].claim
    assert "https://EVIL.com" not in claim
    assert "hxxps://EVIL[.]com" in claim


@pytest.mark.asyncio
async def test_report_flags_payment_check_for_critical_band(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found several signals consistent with known scam patterns.",
                      what_to_verify=["Verify the domain."]), \
               NodeUsage(node=node, model="cheap", usd=0.002)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state(band="CRITICAL")
    out = await report.report_generation(state)
    checklist = out["deterministic_signals"]["what_to_verify"]
    assert any("pay" in item.lower() or "fee" in item.lower() or "payment" in item.lower()
               for item in checklist)


@pytest.mark.asyncio
async def test_report_flags_payment_check_for_high_band(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found several signals consistent with known scam patterns.",
                      what_to_verify=["Verify the domain."]), \
               NodeUsage(node=node, model="cheap", usd=0.002)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = _state(band="HIGH")
    out = await report.report_generation(state)
    checklist = out["deterministic_signals"]["what_to_verify"]
    assert any("pay" in item.lower() or "fee" in item.lower() or "payment" in item.lower()
               for item in checklist)
