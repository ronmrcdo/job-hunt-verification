"""The entire HTTP surface (spec §6): Inngest serve + liveness. No user routes.

Verified against the installed inngest 0.5.19: this version ships no
Starlette-specific serve helper (only `inngest.flask`, `inngest.django`,
`inngest.fast_api`, `inngest.tornado`, `inngest.digital_ocean`); the ASGI
option is `inngest.fast_api.serve(app, client, functions)`, which requires a
real `fastapi.FastAPI` instance (it registers routes via `app.get/post/put`,
which `starlette.applications.Starlette` does not expose). FastAPI is
already a project dependency and is itself an ASGI app, so it's used here
directly instead of a bare Starlette app. `inngest.fast_api.serve` mounts
GET/POST/PUT at `const.DEFAULT_SERVE_PATH` ("/api/inngest") by default.
"""
import uuid
import inngest
import inngest.fast_api
from fastapi import FastAPI

from app.worker.functions import handle_failure, handle_requested, handle_sweep
from app.worker.persistence import Persistence

# Mode is env-driven, NOT hardcoded, so the same image serves dev and prod.
# Verified in inngest 0.5.19 (client_lib/client.py::_get_mode): with
# `is_production=None` the SDK falls back to the INNGEST_DEV env var —
# truthy => DEV_SERVER (no signature verification, dev-server default
# origins), unset/empty => CLOUD (verifies the X-Inngest-Signature header
# against INNGEST_SIGNING_KEY and signs events with INNGEST_EVENT_KEY).
# client_lib/utils.py resolves the server origins from INNGEST_BASE_URL in
# BOTH modes, so CLOUD mode still points at our self-hosted `inngest start`
# rather than inngest.com.
#   dev  → INNGEST_DEV=1        + INNGEST_BASE_URL=http://inngest:8288
#   prod → INNGEST_DEV unset    + INNGEST_BASE_URL=http://inngest:8288
#                               + INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY
inngest_client = inngest.Inngest(app_id="job-hunt-verification")


async def _on_run_investigation_failure(ctx: inngest.Context) -> None:
    # Verified against installed inngest 0.5.19 (site-packages/inngest/_internal/
    # function.py: FunctionOpts.on_failure registers a second function whose
    # trigger is the platform-internal event server_lib.InternalEvents.
    # FUNCTION_FAILED = "inngest/function.failed"; comm_lib/handler.py builds
    # the on_failure Context the same way as the main one, binding
    # `ctx.event = request.event` straight from the inbound request body — i.e.
    # the failure handler receives a Context whose `.event` IS the
    # "inngest/function.failed" system event, not the original
    # "investigation.requested" event. Per Inngest's documented
    # function.failed payload, that system event's `data` nests the original
    # triggering event under the "event" key, so the original event body is
    # at ctx.event.data["event"]["data"].
    original_event_data = ctx.event.data["event"]["data"]
    inv_id = uuid.UUID(original_event_data["investigation_id"])
    await handle_failure(inv_id, persistence=Persistence())


@inngest_client.create_function(
    fn_id="run-investigation",
    trigger=inngest.TriggerEvent(event="investigation.requested"),
    retries=2,
    on_failure=_on_run_investigation_failure,
)
async def run_investigation_fn(ctx: inngest.Context) -> str:
    inv_id = uuid.UUID(ctx.event.data["investigation_id"])
    return await handle_requested(inv_id, persistence=Persistence())


@inngest_client.create_function(
    fn_id="sweep-stale-queued",
    trigger=inngest.TriggerCron(cron="*/10 * * * *"),
)
async def sweep_stale_queued_fn(ctx: inngest.Context) -> None:
    async def emit(inv_id):
        await inngest_client.send(inngest.Event(
            name="investigation.requested",
            id=str(inv_id),
            data={"investigation_id": str(inv_id)}))

    await handle_sweep(persistence=Persistence(), emit=emit)


app = FastAPI()


@app.get("/healthz")
async def healthz():
    return {"ok": True}


inngest.fast_api.serve(app, inngest_client, [run_investigation_fn, sweep_stale_queued_fn])
