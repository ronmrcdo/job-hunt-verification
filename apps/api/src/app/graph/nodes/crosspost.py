"""Cross-post detector graph node.

Cross-posting to Indeed/ZipRecruiter/etc. is normal and must NOT be
flagged (spec §7) — the scam signal is the SAME job appearing elsewhere
with DIFFERENT contact information (email) than the submission. This
node therefore compares the set of emails mentioned in each search hit
against the set of emails known from the submission/entities, never the
hit's URL or board identity: same contact => ordinary cross-posting,
different contact => a contact-swap `Finding`.

`build_crosspost_queries` returns `[]` when there is no `job_title`
(carry-in guard from Task 3.1); this node must not call Tavily with an
empty query list, so it returns early with no sources/findings/cost.
"""
import re
from datetime import datetime, timezone

from app.graph.nodes.research import stable_source_id
from app.graph.state import InvestigationState, Source, Finding
from app.tools.tavily import tavily_search, build_crosspost_queries

_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.\w+")


def _emails(text: str) -> set[str]:
    return {m.group(0).lower() for m in _EMAIL.finditer(text or "")}


async def job_crosspost_search(state: InvestigationState) -> dict:
    queries = build_crosspost_queries(state.entities)
    if not queries:
        return {"raw_sources": [], "raw_findings": [], "cost_events": []}

    own = _emails(state.submission.job_text) | _emails(state.entities.recruiter_email or "")
    sources: list[Source] = []
    findings: list[Finding] = []
    for q in queries:
        for hit in await tavily_search(q):
            other = _emails(hit.content)
            src = Source(
                id=stable_source_id("raw_xp", hit.url),
                url=hit.url,
                kind="search_result",
                retrieved_at=datetime.now(timezone.utc),
                content_summary=hit.content[:500],
                raw_excerpt=hit.content[:2000],
            )
            sources.append(src)
            # Contact-swap signal: emails found on this hit, and known
            # emails from our own submission, but no overlap between them.
            if own and other and not (other & own):
                findings.append(Finding(
                    id=stable_source_id("xp", hit.url),
                    category="cross_source",
                    direction="suspicious",
                    severity="medium",
                    claim="The same job appears elsewhere with different contact information "
                          "than the submission.",
                    source_ids=[src.id],
                    provenance="web_verified",
                ))
    return {"raw_sources": sources, "raw_findings": findings, "cost_events": []}
