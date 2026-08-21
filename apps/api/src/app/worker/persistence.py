"""The only writer of client-visible investigation data (spec §3). Every write
goes through shape(): source url defanged, raw_excerpt capped to 500 chars
and defanged; finding claims, the assessment summary, and each
what_to_verify item defanged. The pre-dedupe raw_sources/raw_findings
channels are never persisted here."""
import json, uuid
from app import db
from app.config import settings
from app.graph.state import RawSubmission, Source, Finding, FinalAssessment
from app.graph.steps import StepDef
from app.security.defang import defang_text, defang_url

_EXCERPT = 500

def shape(sources, findings, assessment, what_to_verify):
    # Defang BEFORE capping: defanging expands text (http:// -> hxxp://,
    # "." -> "[.]"), so capping first could leave a defanged excerpt over
    # 500 chars. Defanging first and then slicing keeps both invariants:
    # no raw scheme survives, and the stored excerpt is never longer than
    # _EXCERPT. The source url itself is also client-visible, so it's
    # defanged too (a bare hyperlink to the thing being investigated is the
    # same "hyperlinked report" risk defang_text guards elsewhere).
    sources = [s.model_copy(update={"url": defang_url(s.url) if s.url else s.url,
                                     "raw_excerpt": defang_text(s.raw_excerpt or "")[:_EXCERPT]})
               for s in sources]
    findings = [f.model_copy(update={"claim": defang_text(f.claim)}) for f in findings]
    assessment = (assessment.model_copy(update={"summary": defang_text(assessment.summary)})
                  if assessment else None)
    what_to_verify = [defang_text(v) for v in (what_to_verify or [])]
    return sources, findings, assessment, what_to_verify


# The client-visible subset of ExtractedEntities: exactly the fields the
# report's detail grid renders (job, company, recruiter, channel). The
# internal signals the checks nodes use — company_domain,
# candidate_real_domain, key_phrases — deliberately stay server-side.
_DISPLAY_FIELDS = ("company_name", "job_title", "salary", "recruiter_name", "contact_channel")


def display_entities(entities) -> dict | None:
    """Whitelist + defang the extracted entities for storage. Returns None
    when the posting yielded none of them, so the column stays null rather
    than holding an all-null object the client would have to special-case."""
    if entities is None:
        return None
    out = {f: getattr(entities, f, None) for f in _DISPLAY_FIELDS}
    if not any(out.values()):
        return None
    return {k: (defang_text(v) if v else None) for k, v in out.items()}


class Persistence:
    """The real StepSink + result/row writer, bound to db.get_pool(). The
    worker is the only writer of client-visible investigation data (spec §3);
    persist_result() is the sole path that shapes a result before it lands in
    a column a client can read."""

    async def seed(self, inv_id, steps: list[StepDef]) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            for s in steps:
                await c.execute(
                    "INSERT INTO investigation_steps "
                    "(investigation_id, step_key, label, display_order, status) "
                    "VALUES (%s,%s,%s,%s,'pending') ON CONFLICT DO NOTHING",
                    (inv_id, s.step_key, s.label, s.display_order))

    async def running(self, inv_id, step_key, at) -> None:
        await self._mark(inv_id, step_key, "running", started=at)

    async def done(self, inv_id, step_key, at) -> None:
        await self._mark(inv_id, step_key, "done", finished=at)

    async def _mark(self, inv_id, step_key, status, *, started=None, finished=None) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            # ON CONFLICT re-inserts placeholder label=''/display_order=0,
            # but that placeholder only ever lands on the impossible path
            # where this step_key was never seeded — on the normal path
            # ON CONFLICT DO UPDATE preserves the seeded label/order and
            # only touches status/timestamps, so a retry replay rewrites
            # identical terminal rows without clobbering an earlier timestamp.
            await c.execute(
                "INSERT INTO investigation_steps "
                "(investigation_id, step_key, label, display_order, status, started_at, finished_at) "
                "VALUES (%s,%s,'',0,%s,%s,%s) "
                "ON CONFLICT (investigation_id, step_key) DO UPDATE SET "
                "status=EXCLUDED.status, "
                "started_at=COALESCE(EXCLUDED.started_at, investigation_steps.started_at), "
                "finished_at=COALESCE(EXCLUDED.finished_at, investigation_steps.finished_at)",
                (inv_id, step_key, status, started, finished))

    async def backfill(self, inv_id) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute("UPDATE investigation_steps SET status='skipped' "
                            "WHERE investigation_id=%s AND status='pending'", (inv_id,))
            await c.execute("UPDATE investigation_steps SET status='failed', finished_at=now() "
                            "WHERE investigation_id=%s AND status='running'", (inv_id,))

    async def set_status(self, inv_id, status) -> None:
        pool = await db.get_pool()
        async with pool.connection() as c:
            if status == "running":
                # Stamp the real run-start so zombie_running measures the hard
                # deadline from here, not from created_at (review Important #3).
                await c.execute(
                    "UPDATE investigations SET status=%s, started_at=now() WHERE id=%s",
                    (status, inv_id))
            else:
                await c.execute(
                    "UPDATE investigations SET status=%s WHERE id=%s", (status, inv_id))

    async def get_submission(self, inv_id):
        pool = await db.get_pool()
        async with pool.connection() as c:
            cur = await c.execute("SELECT submission, status FROM investigations WHERE id=%s", (inv_id,))
            row = await cur.fetchone()
        return RawSubmission(**row["submission"]), row["status"]

    async def persist_result(self, inv_id, *, assessment, findings, sources, cost,
                             what_to_verify, check_count=None, status=None, title=None,
                             entities=None) -> None:
        # status is optional so this write can double as the terminal write:
        # folding status into the same UPDATE as the results makes the pair
        # atomic on one connection, closing the crash window where a row was
        # left with results but status still 'running' (review Important #4).
        # title is the worker-derived display label (extracted company name,
        # falling back to job title); defanged here because it originates in
        # untrusted posting text and is client-visible, same as every other
        # column this method writes. entities arrives already whitelisted and
        # defanged by display_entities() — this method does not re-defang it.
        sources, findings, assessment, what_to_verify = shape(sources, findings, assessment, what_to_verify)
        pool = await db.get_pool()
        args = [
            json.dumps(assessment.model_dump(mode="json")) if assessment else None,
            json.dumps([f.model_dump(mode="json") for f in findings]),
            json.dumps([s.model_dump(mode="json") for s in sources]),
            json.dumps(cost), json.dumps(what_to_verify), check_count,
            defang_text(title) if title else None,
            json.dumps(entities) if entities else None,
        ]
        set_cols = ("assessment=%s, findings=%s, sources=%s, cost=%s, "
                    "what_to_verify=%s, check_count=%s, title=%s, entities=%s")
        if status is not None:
            set_cols += ", status=%s"
            args.append(status)
        args.append(inv_id)
        async with pool.connection() as c:
            await c.execute(f"UPDATE investigations SET {set_cols} WHERE id=%s", tuple(args))

    async def day_spend_usd(self) -> float:
        pool = await db.get_pool()
        async with pool.connection() as c:
            cur = await c.execute(
                "SELECT COALESCE(SUM((cost->>'total_usd')::numeric), 0) AS s "
                "FROM investigations "
                "WHERE created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')")
            row = await cur.fetchone()
        return float(row["s"])

    async def mark_capacity_blocked(self, inv_id) -> None:
        # Terminal 'failed' + a cost marker the client can detect to show
        # capacity-specific copy (spec §4.3). No graph ran, so no results.
        pool = await db.get_pool()
        async with pool.connection() as c:
            await c.execute(
                "UPDATE investigations SET status='failed', "
                "cost='{\"total_usd\":0,\"by_node\":{},\"capacity_blocked\":true}'::jsonb "
                "WHERE id=%s", (inv_id,))

    async def stale_queued(self) -> list[uuid.UUID]:
        """Investigations still 'queued' past `stale_queued_threshold_s` after
        creation — the request event was presumably lost, so the sweeper
        re-emits it (spec §6)."""
        pool = await db.get_pool()
        async with pool.connection() as c:
            cur = await c.execute(
                "SELECT id FROM investigations WHERE status='queued' "
                "AND created_at < now() - (%s || ' seconds')::interval",
                (settings.stale_queued_threshold_s,))
            rows = await cur.fetchall()
        return [row["id"] for row in rows]

    async def zombie_running(self) -> list[uuid.UUID]:
        """Investigations still 'running' far past the hard deadline
        (`zombie_running_threshold_s`) after they actually started — the
        worker died mid-run without reaching a terminal status, so the
        sweeper fails and backfills them (spec §6). Measured from
        `started_at` (the worker's run-start via set_status('running')), not
        `created_at`: a re-emitted stale-queued row that legitimately starts
        running only just then begins its deadline window (review Important
        #3). A 'running' row with a NULL started_at is never swept — that can
        only happen if the run never passed through set_status('running'),
        which the normal path guarantees. `stale_queued` is unchanged: queued
        rows have no run-start, so `created_at` is still correct there."""
        pool = await db.get_pool()
        async with pool.connection() as c:
            cur = await c.execute(
                "SELECT id FROM investigations WHERE status='running' "
                "AND started_at IS NOT NULL "
                "AND started_at < now() - (%s || ' seconds')::interval",
                (settings.zombie_running_threshold_s,))
            rows = await cur.fetchall()
        return [row["id"] for row in rows]
