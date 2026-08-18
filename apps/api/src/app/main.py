"""FastAPI HTTP surface (Task 5.7): mints investigations, runs the compiled
LangGraph, persists the canonical (never raw-accumulator) result, and serves
it back with server-side ownership checks.

V0 notes / deferred work:
- Ownership uses an `X-Owner-Key` header as a stand-in for accounts (spec
  §9.6). There is no account system in V0, so per-user rate limiting is
  deferred to V1 (TODO) — nothing meaningful to key a limiter on yet.
- The graph runs synchronously in-request (matches the V0 ~90s soft
  deadline, spec §9.4/§12). V1 TODO: move this behind FastAPI
  BackgroundTasks with an immediate "running" status so POST returns fast
  and the client polls GET, per the Task 5.7 brief's production note.
"""
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app import db
from app.cache import bump_check_count, dedupe_key, get_cached_report, put_cached_report
from app.config import settings
from app.cost_tracker import summarize
from app.graph.build import run_investigation
from app.graph.state import FinalAssessment, Finding, InvestigationState, RawSubmission, Source

logger = logging.getLogger(__name__)

app = FastAPI(title="job-hunt-verification", version="0.0.0")

# Dev/test store, used only when no real Postgres is configured (DATABASE_URL
# unset in the environment). The branch on _use_memory_store() lives entirely
# inside _persist/load_result — route handlers never look at this directly.
_RESULTS: dict[str, dict] = {}


def _use_memory_store() -> bool:
    return not os.getenv("DATABASE_URL")


class CreateRequest(BaseModel):
    job_text: str
    company_name: str | None = None
    recruiter_email: str | None = None
    job_url: str | None = None

    @field_validator("job_text")
    @classmethod
    def _cap(cls, v: str) -> str:
        # Input cap (spec §9.4): reject before anything runs, not after.
        if len(v) > settings.max_job_text_chars:
            raise ValueError(
                f"job_text exceeds max_job_text_chars ({settings.max_job_text_chars})")
        return v


class CreateResponse(BaseModel):
    id: uuid.UUID


class InvestigationResponse(BaseModel):
    id: uuid.UUID
    status: str
    assessment: FinalAssessment | None
    findings: list[Finding]
    sources: list[Source]  # excerpts only — see _excerpt_sources
    cost: dict
    # Surfaced on a cache hit ("checked N times recently", spec §11); None
    # for a fresh (non-deduped) run.
    check_count: int | None = None


def _excerpt_sources(sources: list[Source]) -> list[Source]:
    """Defensive re-cap. `Source.raw_excerpt` is already meant to hold an
    excerpt, not full raw HTML (full fetched content is never carried in
    InvestigationState — canonical `sources`/`findings` are the only fields
    this API is allowed to expose; the pre-dedupe `raw_sources`/`raw_findings`
    accumulator channels on InvestigationState are never read here). This
    just enforces the response-size contract even if an upstream node ever
    over-fills raw_excerpt."""
    return [s.model_copy(update={"raw_excerpt": (s.raw_excerpt or "")[:500]}) for s in sources]


async def _persist(inv_id: uuid.UUID, owner: str, status: str, submission: RawSubmission,
                    assessment: FinalAssessment | None, findings: list[Finding],
                    sources: list[Source], cost: dict, check_count: int | None = None) -> None:
    sources = _excerpt_sources(sources)
    if _use_memory_store():
        _RESULTS[str(inv_id)] = {
            "owner": owner, "status": status, "assessment": assessment,
            "findings": findings, "sources": sources, "cost": cost,
            "check_count": check_count,
        }
        return
    pool = await db.get_pool()
    async with pool.connection() as c:
        await c.execute(
            "INSERT INTO investigations (id, owner_key, status, submission, assessment, findings, cost) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, assessment=EXCLUDED.assessment, "
            "findings=EXCLUDED.findings, cost=EXCLUDED.cost",
            (inv_id, owner, status,
             json.dumps(submission.model_dump(mode="json")),
             json.dumps(assessment.model_dump(mode="json")) if assessment else None,
             json.dumps([f.model_dump(mode="json") for f in findings]),
             json.dumps(cost)))
    # Persist sources for audit (spec: "persists raw sources + result"). Only
    # the already-excerpted text we hold is written — this API never has
    # full raw HTML to begin with.
    for s in sources:
        await db.save_raw_source(inv_id, s.id, s.url, s.raw_excerpt or "")


async def load_result(inv_id: uuid.UUID, owner: str) -> dict | None:
    if _use_memory_store():
        rec = _RESULTS.get(str(inv_id))
        if not rec or rec["owner"] != owner:
            return None
        return rec
    pool = await db.get_pool()
    async with pool.connection() as c:
        cur = await c.execute(
            "SELECT owner_key, status, assessment, findings, cost FROM investigations WHERE id=%s",
            (inv_id,))
        row = await cur.fetchone()
    if not row or row["owner_key"] != owner:
        return None
    src_rows = await db.load_raw_sources(inv_id)
    sources = [
        Source(id=r["source_id"], url=r["url"], kind="fetched_page",
               retrieved_at=datetime.now(timezone.utc), content_summary=(r["raw"] or "")[:200],
               raw_excerpt=r["raw"])
        for r in src_rows
    ]
    return {
        "owner": row["owner_key"],
        "status": row["status"],
        "assessment": FinalAssessment(**row["assessment"]) if row["assessment"] else None,
        "findings": [Finding(**f) for f in (row["findings"] or [])],
        "sources": sources,
        "cost": row["cost"] or {},
        "check_count": None,
    }


async def _run_with_deadline(submission: RawSubmission, inv_id: uuid.UUID) -> tuple[InvestigationState, str]:
    """Route-level backstop for the total deadline (spec §9.4/§12). The graph
    (5.6) already enforces this internally via its own asyncio.wait_for and
    best-effort checkpoint fallback; this wraps the call again so a hang
    anywhere before the first checkpoint write still can't hang the request
    indefinitely."""
    try:
        state = await asyncio.wait_for(
            run_investigation(submission, investigation_id=inv_id),
            timeout=settings.total_deadline_s)
        return state, "done"
    except asyncio.TimeoutError:
        logger.warning("investigation %s exceeded route-level deadline of %.1fs",
                        inv_id, settings.total_deadline_s)
        return InvestigationState(submission=submission), "deadline_exceeded"


@app.post("/investigations", response_model=CreateResponse, status_code=201)
async def create(req: CreateRequest, x_owner_key: str = Header(...)) -> CreateResponse:
    inv_id = uuid.uuid4()
    submission = RawSubmission(**req.model_dump())

    key = dedupe_key(submission)
    if key:
        cached = await get_cached_report(key)
        if cached is not None:
            n = await bump_check_count(key)
            assessment = FinalAssessment(**cached["assessment"]) if cached.get("assessment") else None
            findings = [Finding(**f) for f in cached.get("findings", [])]
            sources = [Source(**s) for s in cached.get("sources", [])]
            await _persist(inv_id, x_owner_key, "done", submission, assessment, findings,
                            sources, cached.get("cost", {}), check_count=n)
            return CreateResponse(id=inv_id)

    state, status = await _run_with_deadline(submission, inv_id)
    cost = summarize(state.cost_events)
    await _persist(inv_id, x_owner_key, status, submission, state.assessment, state.findings,
                    state.sources, cost)
    if key and status == "done":
        # Only reachable on a genuine cache MISS — never re-put over a still
        # valid entry, which would reset bump_check_count's counter.
        await put_cached_report(key, {
            "assessment": state.assessment.model_dump(mode="json") if state.assessment else None,
            "findings": [f.model_dump(mode="json") for f in state.findings],
            "sources": [s.model_dump(mode="json") for s in _excerpt_sources(state.sources)],
            "cost": cost,
        })
    return CreateResponse(id=inv_id)


@app.get("/investigations/{inv_id}", response_model=InvestigationResponse)
async def get(inv_id: uuid.UUID, x_owner_key: str = Header(...)) -> InvestigationResponse:
    rec = await load_result(inv_id, x_owner_key)
    if not rec:
        # 404, never 403 (spec §9.6): don't leak whether the id exists.
        raise HTTPException(status_code=404, detail="not found")
    return InvestigationResponse(
        id=inv_id,
        status=rec["status"],
        assessment=rec["assessment"],
        findings=rec["findings"],
        sources=rec["sources"],
        cost=rec["cost"],
        check_count=rec.get("check_count"),
    )


@app.exception_handler(Exception)
async def _no_leak(_request, exc: Exception) -> JSONResponse:
    # No secrets/cost internals in client-visible errors (spec §9.6) — log
    # details server-side only.
    logger.exception("unhandled error in request", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "internal error"})
