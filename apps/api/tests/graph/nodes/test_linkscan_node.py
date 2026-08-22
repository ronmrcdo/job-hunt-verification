import pytest
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities
from app.graph.nodes.linkscan_node import linkscan_node


@pytest.mark.asyncio
async def test_pasted_download_is_user_provided_alert():
    state = InvestigationState(
        submission=RawSubmission(job_text="install https://x.io/app.apk", company_name="Acme"),
        entities=ExtractedEntities(company_name="Acme"))
    out = await linkscan_node(state)
    fs = out["raw_findings"]
    assert fs and fs[0].user_safety_alert is True
    assert fs[0].provenance == "user_provided_unverified"
    assert fs[0].source_ids == ["src_det_posting"]


@pytest.mark.asyncio
async def test_fetched_posting_link_is_web_verified():
    state = InvestigationState(
        submission=RawSubmission(job_text="see details"),
        fetched_posting="download https://x.io/setup.exe",
        verified_canonical_domain="acme.com",
        entities=ExtractedEntities(company_name="Acme"))
    out = await linkscan_node(state)
    fs = [f for f in out["raw_findings"] if f.provenance == "web_verified"]
    assert fs and fs[0].user_safety_alert is True
    assert fs[0].source_ids == ["src_det_fetched"]


@pytest.mark.asyncio
async def test_no_links_no_findings():
    state = InvestigationState(submission=RawSubmission(job_text="clean posting"))
    assert await linkscan_node(state) == {"raw_findings": []}
