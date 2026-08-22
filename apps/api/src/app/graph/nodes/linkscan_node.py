"""Weaponized-recruitment link-scan node (spec §9.7).

Deterministic fan-out branch. Scans the pasted posting (user_provided_unverified)
and any backend-fetched posting (web_verified) for download/login/sign-up links.
The reference domain is `verified_canonical_domain` — only a research-confirmed
domain (never the LLM-extracted `candidate_real_domain`) is trusted enough to
call something a lookalike (spec §9.7 Gap A / S5).
"""
from app.graph.state import InvestigationState
from app.checks.link_scan import scan_links


async def linkscan_node(state: InvestigationState) -> dict:
    ref = state.verified_canonical_domain
    verified = ref is not None
    findings = []
    findings += scan_links(state.submission.job_text or "",
                           provenance="user_provided_unverified",
                           canonical_domain=ref, canonical_verified=verified,
                           id_prefix="linkscan_paste",
                           source_ids=["src_det_posting"])
    if state.fetched_posting:
        findings += scan_links(state.fetched_posting,
                               provenance="web_verified",
                               canonical_domain=ref, canonical_verified=verified,
                               id_prefix="linkscan_fetched",
                               source_ids=["src_det_fetched"])
    return {"raw_findings": findings}
