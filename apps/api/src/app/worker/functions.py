"""Inngest workflow functions (spec §6). handle_requested is the testable core:
cache check -> running -> run+emit -> shaped persist -> terminal status. A soft
timeout is a clean return ('deadline_exceeded'); only unexpected exceptions
propagate to Inngest's retry budget (retries:2) and on_failure (gap #5, spec §8).
handle_failure is the on_failure core: once retries are exhausted, mark the run
'failed' and back-fill its steps (spec §8) — wired in worker/app.py.
handle_sweep is the sweeper core: re-emit each stale-queued investigation's
request event, and fail+backfill each zombie-running one (spec §6)."""
import logging, uuid
from app import cache
from app.config import settings
from app.cost_tracker import summarize
from app.graph.state import FinalAssessment, Finding, Source
from app.worker.persistence import Persistence, shape
from app.worker.runner import run_and_emit

logger = logging.getLogger(__name__)


def _a(c):
    return FinalAssessment(**c["assessment"]) if c.get("assessment") else None


def _f(c):
    return [Finding(**x) for x in c.get("findings", [])]


def _s(c):
    return [Source(**x) for x in c.get("sources", [])]


def _title(entities) -> str | None:
    """Display label for the check list: the extracted company name, falling
    back to the job title when the posting named no company. None when neither
    could be read — the client renders its own 'Untitled posting' fallback."""
    return (entities.company_name or entities.job_title) or None


async def handle_requested(inv_id: uuid.UUID, *, persistence: Persistence, run=run_and_emit) -> str:
    submission, _status = await persistence.get_submission(inv_id)

    key = cache.dedupe_key(submission)
    if key:
        cached = await cache.get_cached_report(key)
        if cached is not None:
            n = await cache.bump_check_count(key)
            await persistence.persist_result(
                inv_id, assessment=_a(cached), findings=_f(cached), sources=_s(cached),
                cost=cached.get("cost", {}), what_to_verify=cached.get("what_to_verify", []),
                check_count=n, title=cached.get("title"),
                status="done")   # atomic; cache-hit writes NO steps (spec §5)
            return "done"

    if await persistence.day_spend_usd() >= settings.global_daily_usd_ceiling:
        logger.warning("global daily ceiling reached; refusing investigation %s", inv_id)
        await persistence.mark_capacity_blocked(inv_id)
        return "failed"

    await persistence.set_status(inv_id, "running")
    try:
        state, status = await run(inv_id, submission, persistence)
    except Exception:
        # Logged server-side only (spec §8) before propagating to Inngest's
        # retry budget (retries:2) / on_failure — the client never sees this.
        logger.exception("investigation %s run failed", inv_id)
        raise
    cost = summarize(state.cost_events)
    what = state.deterministic_signals.get("what_to_verify", [])
    title = _title(state.entities)
    await persistence.persist_result(inv_id, assessment=state.assessment, findings=state.findings,
                                     sources=state.sources, cost=cost, what_to_verify=what,
                                     title=title,
                                     status=status)   # atomic 'done' | 'deadline_exceeded'
    if key and status == "done":
        shaped_sources, shaped_findings, shaped_assessment, shaped_what = shape(
            state.sources, state.findings, state.assessment, what)
        await cache.put_cached_report(key, {
            "assessment": shaped_assessment.model_dump(mode="json") if shaped_assessment else None,
            "findings": [f.model_dump(mode="json") for f in shaped_findings],
            "sources": [s.model_dump(mode="json") for s in shaped_sources],
            "cost": cost, "what_to_verify": shaped_what, "title": title})
    return status


async def handle_failure(inv_id: uuid.UUID, *, persistence: Persistence) -> None:
    """Inngest exhausted the retry budget (retries:2) for run-investigation
    (spec §8): mark the run terminal and back-fill any steps left running/pending
    so the client never sees a stuck run."""
    logger.error("investigation %s exhausted retries; marking failed", inv_id)
    await persistence.set_status(inv_id, "failed")
    await persistence.backfill(inv_id)


async def handle_sweep(*, persistence: Persistence, emit) -> None:
    for inv_id in await persistence.stale_queued():
        await emit(inv_id)
    for inv_id in await persistence.zombie_running():
        await persistence.set_status(inv_id, "failed")
        await persistence.backfill(inv_id)
