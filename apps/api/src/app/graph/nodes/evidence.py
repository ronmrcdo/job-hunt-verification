from datetime import datetime, timezone

from app.graph.nodes.url_fetch import fetch_target
from app.graph.state import InvestigationState, Source, Finding

# Mirrors app.graph.nodes.research.EXCERPT_CAP -- keep unbounded posting text
# out of graph state, same as every other Source.
POSTING_EXCERPT_CAP = 2000
POSTING_SOURCE_PREFIX = "Submitted job posting text:"


def _posting_source(state: InvestigationState) -> Source | None:
    """Turns the submitter's pasted job posting into a canonical, citable
    `Source` (spec §4, §9.2, §14 -- V0 is posting-only, no job_url fetch).
    This is the ONLY conduit by which the posting's own content reaches
    analysis's evidence pack and the injection scanner in V0; without it
    the §9.2 injection guardrail never sees its primary input.

    Built here in evidence_assembly (deterministic, always real -- the eval
    harness stubs the LLM/network nodes but not this one) rather than in
    intake_extraction (an LLM node, stubbed in eval), so the guardrail is
    exercised on the real path everywhere, including the eval harness.

    Uses the `src_det_*` canonical-id convention (see checks_node.py) so the
    dedup loop below preserves it as-is. `kind="user_provided"` marks it as
    submitter-supplied, not a deterministic lookup result -- downstream
    consumers (injection scan, analysis's evidence pack) still treat it as
    untrusted, attacker-influenced content like any other source."""
    text = state.submission.job_text
    if not text:
        return None
    excerpt = text[:POSTING_EXCERPT_CAP]
    return Source(
        id="src_det_posting", url=state.submission.job_url, kind="user_provided",
        retrieved_at=datetime.now(timezone.utc),
        content_summary=f"{POSTING_SOURCE_PREFIX} {excerpt}",
        raw_excerpt=excerpt,
    )


FETCHED_SOURCE_PREFIX = "Fetched job posting page:"


def _fetched_source(state: InvestigationState) -> Source | None:
    """The page fetched from a submitted link (url_fetch node), as a canonical
    citable Source so it flows into injection scanning and analysis exactly
    like the pasted posting. Untrusted, attacker-influenced content (spec
    §9.2): kind='fetched_page', treated as data everywhere downstream."""
    text = state.fetched_posting
    if not text:
        return None
    excerpt = text[:POSTING_EXCERPT_CAP]
    return Source(
        id="src_det_fetched", url=fetch_target(state.submission), kind="fetched_page",
        retrieved_at=datetime.now(timezone.utc),
        content_summary=f"{FETCHED_SOURCE_PREFIX} {excerpt}",
        raw_excerpt=excerpt,
    )


def evidence_assembly(state: InvestigationState) -> dict:
    """Consolidates the fan-out branches' accumulated raw_sources/raw_findings
    (additive-reducer channels, so concurrent branch writes don't conflict)
    into the canonical, replace-semantics sources/findings the rest of the
    graph (post-barrier) reads. Never exposes raw_* outside the graph.

    Also injects the pasted job posting itself as a canonical Source (see
    `_posting_source`) so it flows into injection scanning and analysis."""
    id_map: dict[str, str] = {}          # old id -> canonical id
    url_to_canonical: dict[str, str] = {}
    canonical_sources = []
    counter = 1

    all_sources = state.sources + state.raw_sources
    posting_src = _posting_source(state)
    if posting_src is not None:
        all_sources = all_sources + [posting_src]

    fetched_src = _fetched_source(state)
    if fetched_src is not None:
        all_sources = all_sources + [fetched_src]
    if state.fetch_failed:
        all_sources = all_sources + [Source(
            id="src_det_fetch_failed", url=fetch_target(state.submission), kind="user_provided",
            retrieved_at=datetime.now(timezone.utc),
            content_summary="The submitted job link could not be retrieved.",
            raw_excerpt=None,
        )]

    for src in all_sources:
        if src.id.startswith("src_det_"):        # already canonical deterministic source
            id_map[src.id] = src.id
            canonical_sources.append(src)
            continue
        if src.url and src.url in url_to_canonical:  # duplicate web source
            id_map[src.id] = url_to_canonical[src.url]
            continue
        new_id = f"src_{counter:03d}"
        counter += 1
        id_map[src.id] = new_id
        if src.url:
            url_to_canonical[src.url] = new_id
        canonical_sources.append(src.model_copy(update={"id": new_id}))

    remapped_findings = []
    for f in state.findings + state.raw_findings:
        new_ids = [id_map.get(sid, sid) for sid in f.source_ids]
        # collapse duplicates introduced by dedupe, preserve order
        seen, ordered = set(), []
        for i in new_ids:
            if i not in seen:
                seen.add(i); ordered.append(i)
        remapped_findings.append(f.model_copy(update={"source_ids": ordered}))

    if state.fetch_failed:
        remapped_findings.append(Finding(
            id="fetch_failed", category="job", direction="unverifiable", severity="info",
            claim="We could not retrieve the linked job posting, so its contents were not "
                  "examined — treat as unverifiable, not evidence.",
            source_ids=["src_det_fetch_failed"], provenance="deterministic"))
    return {"sources": canonical_sources, "findings": remapped_findings}
