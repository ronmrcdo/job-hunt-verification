import respx
from httpx import AsyncClient, ASGITransport, Response
from app.worker.app import app

async def test_healthz_ok():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}

@respx.mock
async def test_inngest_endpoint_is_served():
    # PUT triggers the SDK's out-of-band sync, which POSTs to the (dev-mode)
    # Inngest server's /fn/register to register this app's functions. No dev
    # server runs in the test env, so that registration call is mocked.
    respx.post("http://127.0.0.1:8288/fn/register").mock(return_value=Response(200, json={}))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.put("/api/inngest")     # SDK introspection responds 2xx/200-ish
    assert r.status_code == 200
