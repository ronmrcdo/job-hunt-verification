"""Runs the compiled graph via astream_events, translating node lifecycle
events into checklist step upserts (spec §5). Enforces the soft deadline
(spec §8): on timeout it returns the best-effort checkpoint state as
'deadline_exceeded' — a clean return, never a raise (gap #5).

Node lifecycle events verified against the installed langgraph 1.2.11 /
langchain-core 1.5.6: `StateGraph.add_node` coerces every node callable to a
Runnable via `coerce_to_runnable(action, name=node, ...)`
(langgraph/graph/state.py), so a node's `astream_events` events carry
`name` == the node's registration key exactly (e.g. "intake", "report").
`Runnable.astream_events` (langchain_core/runnables/base.py) emits
`event: f"on_{run_type}_{start|end}"`; plain callables coerced to
RunnableLambda/RunnableCallable report `run_type == "chain"`, so graph node
start/end surface as `on_chain_start`/`on_chain_end`. `version="v2"` is the
current (and default) stable schema version for this langchain-core release.
"""
import asyncio
import inspect
import logging
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.graph.build import build_graph
from app.graph.state import InvestigationState, RawSubmission
from app.graph.steps import STEP_REGISTRY

logger = logging.getLogger(__name__)


def _now():
    return datetime.now(timezone.utc)


def _checkpointer_cm():
    """Returns the (unentered) async context manager that yields a live
    Postgres checkpointer. Extracted as its own seam — distinct from
    `_stream_events`/`_final_state` — so tests can swap in a fake and never
    open a real DB connection; production `run_and_emit` always goes through
    this rather than calling `AsyncPostgresSaver.from_conn_string` inline."""
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    return AsyncPostgresSaver.from_conn_string(settings.database_url)


def _stream_events(graph, state, config):
    return graph.astream_events(state, config=config, version="v2")


async def _final_state(graph, config):
    snapshot = await graph.aget_state(config)
    return InvestigationState(**snapshot.values)


async def _maybe_await(value):
    """Awaits `value` if it's awaitable, otherwise returns it as-is. Lets
    `_final_state` (and other seams) be swapped in tests for a plain
    synchronous fake without the production async call site changing."""
    if inspect.isawaitable(value):
        return await value
    return value


async def run_and_emit(
    inv_id: uuid.UUID, submission: RawSubmission, steps
) -> tuple[InvestigationState, str]:
    async with _checkpointer_cm() as cp:
        await cp.setup()  # no-op: tables authored in the checkpointer migration
        graph = build_graph(checkpointer=cp)
        config = {"configurable": {"thread_id": str(inv_id)}}
        await steps.seed(inv_id, list(STEP_REGISTRY.values()))
        try:
            async def _drive():
                async for ev in _stream_events(graph, InvestigationState(submission=submission), config):
                    reg = STEP_REGISTRY.get(ev.get("name"))
                    if not reg:
                        continue
                    if ev["event"] == "on_chain_start":
                        await steps.running(inv_id, reg.step_key, _now())
                    elif ev["event"] == "on_chain_end":
                        await steps.done(inv_id, reg.step_key, _now())

            await asyncio.wait_for(_drive(), timeout=settings.total_deadline_s)
            final = await _maybe_await(_final_state(graph, config))
            return final, "done"
        except asyncio.TimeoutError:
            logger.warning("investigation %s hit soft deadline", inv_id)
            await steps.backfill(inv_id)  # pending->skipped, running->failed
            final = await _maybe_await(_final_state(graph, config))
            return final, "deadline_exceeded"
