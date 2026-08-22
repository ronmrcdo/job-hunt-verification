"""Graph assembly (Task 5.6): wires every node into the compiled LangGraph
StateGraph.

Shape: url_fetch -> intake -> parallel fan-out over {checks, research,
crosspost, conversation} -> evidence barrier (consolidates the fan-out branches'
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
from app.graph.nodes import url_fetch as url_fetch_mod
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


def _with_branch_guard(node, *, name: str, category):
    """Wraps a fan-out branch node so that neither a timeout nor a raised
    exception can take down the whole investigation. On timeout (a hung
    node) OR any exception (e.g. the company site is unreachable and the
    node raises a ConnectionError), it degrades to a soft "unverifiable"
    finding instead of hanging or crashing — an unreachable source is
    honestly "unverifiable", not a system error, so the run continues and
    reports what it could not confirm (spec §7, §9.4/§12).

    The degraded finding is written via the raw_findings/raw_sources reducer
    channels so a simultaneous failure on another branch can't collide with
    it (a non-reducer field would). It carries its own synthetic Source,
    since citation_validator (3.6) drops any finding that cites no source —
    this keeps the degraded finding from being silently dropped as uncited."""

    def _degraded(reason: str, *, id_prefix: str, summary: str) -> dict:
        src_id = f"src_{id_prefix}_{name}"
        src = Source(
            id=src_id, url=None, kind="dns", retrieved_at=datetime.now(timezone.utc),
            content_summary=summary, raw_excerpt=None,
        )
        finding = Finding(
            id=f"{id_prefix}_{name}",
            category=category,
            direction="unverifiable",
            severity="info",
            claim=f"{reason} — treat as unverifiable, not evidence.",
            source_ids=[src_id],
            provenance="deterministic",
        )
        return {"raw_sources": [src], "raw_findings": [finding]}

    async def wrapped(state: InvestigationState) -> dict:
        try:
            return await asyncio.wait_for(node(state), timeout=settings.branch_timeout_s)
        except asyncio.TimeoutError:
            logger.warning(
                "branch %s exceeded %.1fs timeout — degrading to unverifiable",
                name, settings.branch_timeout_s,
            )
            return _degraded(
                f"{name} did not complete within the time budget",
                id_prefix="timeout",
                summary=f"{name} did not complete within the time budget.",
            )
        except Exception as exc:  # unreachable site, DNS failure, upstream 5xx, etc.
            logger.warning(
                "branch %s failed (%s) — degrading to unverifiable",
                name, type(exc).__name__,
            )
            return _degraded(
                f"{name} could not be completed ({type(exc).__name__})",
                id_prefix="error",
                summary=f"{name} could not be completed: {type(exc).__name__}.",
            )

    return wrapped


def build_graph(checkpointer=None):
    g = StateGraph(InvestigationState)
    g.add_node("url_fetch", url_fetch_mod.url_fetch)
    g.add_node("intake", intake_extraction)
    g.add_node("checks", _with_branch_guard(
        deterministic_checks_node, name="deterministic_checks", category="domain"))
    g.add_node("research", _with_branch_guard(
        company_research, name="company_research", category="company"))
    g.add_node("crosspost", _with_branch_guard(
        job_crosspost_search, name="job_crosspost_search", category="job"))
    g.add_node("conversation", _with_branch_guard(
        conversation_analysis, name="conversation_analysis", category="communication"))  # dormant in V0
    g.add_node("evidence", evidence_assembly)
    g.add_node("injection", _injection_scan)
    g.add_node("analysis", analysis)
    g.add_node("citation", citation_validator)
    g.add_node("advocate", devils_advocate)
    g.add_node("banding", risk_banding)
    g.add_node("report", report_generation)
    g.add_node("linter", language_linter)

    g.add_edge(START, "url_fetch")
    g.add_edge("url_fetch", "intake")
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
