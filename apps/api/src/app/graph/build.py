"""Graph assembly (Task 5.6): wires every node into the compiled LangGraph
StateGraph.

Shape: intake -> parallel fan-out over {checks, research, crosspost,
conversation} -> evidence barrier (consolidates the fan-out branches'
raw_findings/raw_sources accumulators into canonical findings/sources,
see graph/state.py) -> injection scan -> analysis -> citation -> devils
advocate -> banding -> report -> language linter.

`conversation_analysis` is wired in but dormant in V0 (spec §2, §69) — no
V0 UI populates `conversation_text`, so it is a no-op. `re_research` is
deferred to V1 and is NOT part of this graph.

Branch timeouts (spec §9.4/§12): each fan-out branch is wrapped so a hung
node can't hang the whole investigation — on timeout it degrades to a
single "unverifiable" Finding (routed through the raw_findings reducer
channel, safe under concurrent writes) instead of crashing or hanging.
"""
import asyncio
import logging
from datetime import datetime, timezone

from langgraph.graph import StateGraph, START, END

from app.config import settings
from app.graph.state import InvestigationState, Finding, Source
from app.graph.nodes.intake import intake_extraction
from app.graph.nodes.checks_node import deterministic_checks_node
from app.graph.nodes.research import company_research
from app.graph.nodes.crosspost import job_crosspost_search
from app.graph.nodes.conversation import conversation_analysis
from app.graph.nodes.evidence import evidence_assembly
from app.graph.nodes.citation import citation_validator
from app.graph.nodes.analysis import analysis
from app.graph.nodes.devils_advocate import devils_advocate
from app.graph.nodes.banding import risk_banding
from app.graph.nodes.report import report_generation
from app.graph.nodes.language_linter import language_linter
from app.security.injection import injection_findings

logger = logging.getLogger(__name__)


def _injection_scan(state: InvestigationState) -> dict:
    new = injection_findings(state)
    return {"findings": state.findings + new} if new else {}


def _with_branch_timeout(node, *, name: str, category):
    """Wraps a fan-out branch node with `settings.branch_timeout_s`. On
    timeout, degrades to a soft "unverifiable" finding instead of raising —
    written via the raw_findings/raw_sources reducer channels so a
    simultaneous timeout on another branch can't collide with it (a
    non-reducer field would). It carries its own synthetic Source, since
    citation_validator (3.6) drops any finding that cites no source — this
    keeps the degraded finding from being silently dropped as uncited."""

    async def wrapped(state: InvestigationState) -> dict:
        try:
            return await asyncio.wait_for(node(state), timeout=settings.branch_timeout_s)
        except asyncio.TimeoutError:
            logger.warning(
                "branch %s exceeded %.1fs timeout — degrading to unverifiable",
                name, settings.branch_timeout_s,
            )
            src_id = f"src_timeout_{name}"
            src = Source(
                id=src_id, url=None, kind="dns", retrieved_at=datetime.now(timezone.utc),
                content_summary=f"{name} did not complete within the time budget.",
                raw_excerpt=None,
            )
            finding = Finding(
                id=f"timeout_{name}",
                category=category,
                direction="unverifiable",
                severity="info",
                claim=f"{name} did not complete within the time budget — "
                      "treat as unverifiable, not evidence.",
                source_ids=[src_id],
                provenance="deterministic",
            )
            return {"raw_sources": [src], "raw_findings": [finding]}

    return wrapped


def build_graph(checkpointer=None):
    g = StateGraph(InvestigationState)
    g.add_node("intake", intake_extraction)
    g.add_node("checks", _with_branch_timeout(
        deterministic_checks_node, name="deterministic_checks", category="domain"))
    g.add_node("research", _with_branch_timeout(
        company_research, name="company_research", category="company"))
    g.add_node("crosspost", _with_branch_timeout(
        job_crosspost_search, name="job_crosspost_search", category="job"))
    g.add_node("conversation", _with_branch_timeout(
        conversation_analysis, name="conversation_analysis", category="communication"))  # dormant in V0
    g.add_node("evidence", evidence_assembly)
    g.add_node("injection", _injection_scan)
    g.add_node("analysis", analysis)
    g.add_node("citation", citation_validator)
    g.add_node("advocate", devils_advocate)
    g.add_node("banding", risk_banding)
    g.add_node("report", report_generation)
    g.add_node("linter", language_linter)

    g.add_edge(START, "intake")
    for branch in ("checks", "research", "crosspost", "conversation"):
        g.add_edge("intake", branch)
        g.add_edge(branch, "evidence")          # fan-in barrier
    g.add_edge("evidence", "injection")
    g.add_edge("injection", "analysis")
    g.add_edge("analysis", "citation")
    g.add_edge("citation", "advocate")
    g.add_edge("advocate", "banding")
    g.add_edge("banding", "report")
    g.add_edge("report", "linter")
    g.add_edge("linter", END)
    return g.compile(checkpointer=checkpointer)


async def run_investigation(submission, *, investigation_id) -> InvestigationState:
    """Runs one investigation end-to-end against the Postgres checkpointer,
    keyed by `investigation_id` as the LangGraph thread id.

    Enforces the soft total deadline (spec §9.4, ~90s): on timeout, returns
    the best-effort state from the last completed checkpoint step rather
    than crashing or hanging indefinitely. If no checkpoint exists yet
    (timed out before the first step completed), the TimeoutError propagates.
    """
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    async with AsyncPostgresSaver.from_conn_string(settings.database_url) as checkpointer:
        await checkpointer.setup()
        graph = build_graph(checkpointer=checkpointer)
        config = {"configurable": {"thread_id": str(investigation_id)}}
        try:
            result = await asyncio.wait_for(
                graph.ainvoke(InvestigationState(submission=submission), config=config),
                timeout=settings.total_deadline_s,
            )
            return InvestigationState(**result)
        except asyncio.TimeoutError:
            logger.warning(
                "investigation %s exceeded %.1fs soft deadline — returning best-effort state",
                investigation_id, settings.total_deadline_s,
            )
            snapshot = await graph.aget_state(config)
            if not snapshot or not snapshot.values:
                raise
            return InvestigationState(**snapshot.values)
