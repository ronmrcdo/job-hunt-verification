import pytest
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities
from app.graph.nodes import intake
from app.cost_tracker import NodeUsage

@pytest.mark.asyncio
async def test_intake_merges_llm_and_deterministic(monkeypatch):
    llm_out = ExtractedEntities(company_name="Acme", company_domain="acme.co",
                                candidate_real_domain="acme.com", job_title="Engineer",
                                salary="$120k", key_phrases=["urgent start"])
    async def fake_call(model, schema, messages, *, node):
        return llm_out, NodeUsage(node=node, model="cheap", usd=0.001)
    monkeypatch.setattr(intake, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(
        job_text="Acme is hiring an Engineer. Contact jo@acme.com",
        company_name="Acme", recruiter_email="jo@acme.com"))
    out = await intake.intake_extraction(state)
    ent = out["entities"]
    # LLM fields flow through …
    assert ent.job_title == "Engineer"
    # … but the recruiter email is taken verbatim from the immutable submission,
    # never from the LLM (anti-injection):
    assert ent.recruiter_email == "jo@acme.com"
    assert out["cost_events"][0].usd == 0.001

@pytest.mark.asyncio
async def test_intake_truncates_long_text(monkeypatch):
    seen = {}
    async def fake_call(model, schema, messages, *, node):
        seen["len"] = len(str(messages))
        return ExtractedEntities(), NodeUsage(node=node, model="cheap")
    monkeypatch.setattr(intake, "structured_call", fake_call)
    from app.config import settings
    huge = "x" * (settings.max_job_text_chars + 5000)
    state = InvestigationState(submission=RawSubmission(job_text=huge))
    await intake.intake_extraction(state)
    assert seen["len"] < settings.max_job_text_chars + 2000  # truncated before prompt
