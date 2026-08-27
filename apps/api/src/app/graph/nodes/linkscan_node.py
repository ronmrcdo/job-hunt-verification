"""Weaponized-recruitment link-scan node (spec §9.7).

Deterministic fan-out branch. Scans the pasted posting (user_provided_unverified)
and any backend-fetched posting for download/login/sign-up links. A fetched page
is only `web_verified` (cap-exempt) when it was fetched from the company's OWN
verified domain; an attacker-chosen fetch target is scanned as
user_provided_unverified (F3). The reference domain is `verified_canonical_domain`
— only a research-confirmed domain (never the LLM-extracted `candidate_real_domain`)
is trusted enough to call something a lookalike (spec §9.7 Gap A / S5).
"""
from urllib.parse import urlsplit

from app.graph.state import InvestigationState
from app.checks.link_scan import scan_links
from app.checks.domain_match import registrable_suffix_match
from app.graph.nodes.url_fetch import fetch_target


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
        # F3: `web_verified` provenance is cap-exempt (§9.1/Gap-B) and can raise
        # the band — so it may be granted ONLY when the fetched page is the
        # company's OWN verified domain. An attacker-chosen fetch target (a bare
        # job_url / bare-URL job_text pointing at their own page) is scanned as
        # `user_provided_unverified`: still detected + callout, but cap-protected
        # so it can't be used to defame a named company.
        fetched_url = fetch_target(state.submission) or ""
        fetched_host = (urlsplit(fetched_url).hostname or "").lower()
        fetched_trusted = bool(ref and fetched_host
                               and registrable_suffix_match(fetched_host, ref))
        prov = "web_verified" if fetched_trusted else "user_provided_unverified"
        # The fetched posting is raw HTML: scan only its <a href> destinations
        # (not every namespace/asset/CDN URL in the markup), and treat links
        # back into the page's own domain as same-site navigation (§7 FP guard).
        findings += scan_links(state.fetched_posting,
                               provenance=prov,
                               canonical_domain=ref, canonical_verified=verified,
                               id_prefix="linkscan_fetched",
                               source_ids=["src_det_fetched"],
                               html=True, page_domain=fetched_host or None,
                               page_url=fetched_url or None)
    return {"raw_findings": findings}
