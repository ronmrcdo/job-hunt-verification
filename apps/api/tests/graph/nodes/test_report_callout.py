import pytest
from app.graph.nodes.report import build_safety_callouts
from app.graph.nodes import report
from app.graph.state import ExtractedEntities, Finding, InvestigationState, RawSubmission, FinalAssessment
from app.cost_tracker import NodeUsage


def _f(prov, claim):
    return Finding(id="x", category="communication", direction="suspicious", severity="high",
                   claim=claim, provenance=prov, user_safety_alert=True)


def test_unverified_callout_is_entity_decoupled():
    ents = ExtractedEntities(company_name="Acme")
    outs = build_safety_callouts(
        [_f("user_provided_unverified", "log in on a lookalike (https://acme-verify.io/login)")], ents)
    assert outs and "Acme" not in outs[0]              # never names the company when unverified
    assert "hxxps://" in outs[0] or "[.]" in outs[0]   # defanged


def test_web_verified_callout_may_name_company():
    ents = ExtractedEntities(company_name="Acme")
    outs = build_safety_callouts(
        [_f("web_verified", "log in on a lookalike (https://acme-verify.io/login)")], ents)
    assert outs


def test_no_alert_no_callout():
    ents = ExtractedEntities(company_name="Acme")
    f = Finding(id="x", category="communication", direction="suspicious", severity="low",
                claim="c", provenance="user_provided_unverified", user_safety_alert=False)
    assert build_safety_callouts([f], ents) == []


@pytest.mark.asyncio
async def test_report_node_surfaces_safety_callouts(monkeypatch):
    async def fake_call(model, schema, messages, *, node):
        return schema(summary="We found signals consistent with known scam patterns.",
                      what_to_verify=["Verify the domain."]), \
               NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(report, "structured_call", fake_call)
    state = InvestigationState(
        submission=RawSubmission(job_text="x"),
        assessment=FinalAssessment(band="HIGH", confidence="LOW", summary="", coverage=0.2),
        entities=ExtractedEntities(company_name="Acme"),
        findings=[_f("user_provided_unverified",
                      "log in on a lookalike (https://acme-verify.io/login)")],
    )
    out = await report.report_generation(state)
    callouts = out["deterministic_signals"]["safety_callouts"]
    assert callouts
    assert "Acme" not in callouts[0]
    assert "hxxps://" in callouts[0] or "[.]" in callouts[0]
