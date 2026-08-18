"""SSRF-safe HTTP fetcher.

Wraps httpx with the SSRF guard on the initial URL and every redirect hop,
caps response size and time, and returns a small structured result — never
raw page bytes into graph state (spec §3, §9.3). Fetch failures are soft
states, never crashes (spec §7).
"""
import httpx
from pydantic import BaseModel
from app.config import settings
from app.security.ssrf import assert_public_url, SsrfError


class FetchResult(BaseModel):
    url: str
    status: int | None = None
    ok: bool = False
    text: str = ""
    error: str | None = None


async def safe_fetch(url: str, *, max_bytes: int = 2_000_000) -> FetchResult:
    try:
        assert_public_url(url)
    except SsrfError as e:
        return FetchResult(url=url, ok=False, error=str(e))

    async def _check_redirect(response: httpx.Response) -> None:
        loc = response.headers.get("location")
        if loc:
            assert_public_url(str(response.url.join(loc)))

    try:
        async with httpx.AsyncClient(
            timeout=settings.fetch_timeout_s,
            follow_redirects=True,
            max_redirects=5,
            event_hooks={"response": [_check_redirect]},
        ) as client:
            resp = await client.get(url, headers={"User-Agent": "job-hunt-verification/0.0"})
            body = resp.content[:max_bytes]
            return FetchResult(
                url=str(resp.url), status=resp.status_code,
                ok=resp.is_success, text=body.decode(resp.encoding or "utf-8", "replace"))
    except SsrfError as e:
        return FetchResult(url=url, ok=False, error=f"redirect to non-public target: {e}")
    except httpx.TimeoutException:
        return FetchResult(url=url, ok=False, error="request timeout")
    except httpx.HTTPError as e:
        return FetchResult(url=url, ok=False, error=f"fetch error: {e.__class__.__name__}")
