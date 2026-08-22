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
async def test_fetched_posting_link_is_web_verified_on_own_domain():
    # F3: web_verified is granted only when the fetched page IS the company's
    # own verified domain (fetch host registrable-matches verified_canonical_domain).
    state = InvestigationState(
        submission=RawSubmission(job_text="", job_url="https://acme.com/jobs/1"),
        fetched_posting="download https://x.io/setup.exe",
        verified_canonical_domain="acme.com",
        entities=ExtractedEntities(company_name="Acme"))
    out = await linkscan_node(state)
    fs = [f for f in out["raw_findings"] if f.provenance == "web_verified"]
    assert fs and fs[0].user_safety_alert is True
    assert fs[0].source_ids == ["src_det_fetched"]


@pytest.mark.asyncio
async def test_fetched_posting_off_verified_domain_is_user_provided():
    # F3 regression guard: an attacker-chosen fetch target whose host does NOT
    # match the verified canonical domain must be scanned as
    # user_provided_unverified (cap-protected), NOT web_verified — otherwise a
    # danger link on the attacker's own page could defame a named company via
    # the cap-exempt web_verified path.
    state = InvestigationState(
        submission=RawSubmission(job_text="", job_url="https://attacker-site.io/jobs/1"),
        fetched_posting="download https://x.io/setup.exe",
        verified_canonical_domain="acme.com",
        entities=ExtractedEntities(company_name="Acme"))
    out = await linkscan_node(state)
    fetched = [f for f in out["raw_findings"] if f.source_ids == ["src_det_fetched"]]
    assert fetched, "expected the fetched danger link to still be detected"
    assert all(f.provenance == "user_provided_unverified" for f in fetched)
    assert not any(f.provenance == "web_verified" for f in out["raw_findings"])


@pytest.mark.asyncio
async def test_no_links_no_findings():
    state = InvestigationState(submission=RawSubmission(job_text="clean posting"))
    assert await linkscan_node(state) == {"raw_findings": []}
