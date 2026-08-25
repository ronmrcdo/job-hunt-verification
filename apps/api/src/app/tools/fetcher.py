"""SSRF-safe HTTP fetcher.

Wraps httpx with the SSRF guard on the initial URL and every redirect hop,
caps response size and time, and returns a small structured result — never
raw page bytes into graph state (spec §3, §9.3). Fetch failures are soft
states, never crashes (spec §7).

IP pinning (spec §9.3): `assert_public_url`/`resolve_public_ips` validate a
hostname at time T0. httpx's default transport re-resolves DNS itself when
it actually opens the socket, which is a second, independent lookup at time
T1 — an attacker controlling the DNS record (public IP at T0, an internal
or metadata IP at T1, short TTL) can pass the guard and still land the
connection on a private target. To close that TOCTOU gap, we resolve+
validate once per hop and then connect directly to that validated IP
(bypassing the client's own DNS resolution entirely — httpcore's connection
pool keys the TCP connect off the URL's host, so requesting the IP itself
means no second lookup ever happens), while still sending the original
Host header and TLS SNI/server_hostname so virtual hosting and certificate
validation behave exactly as if we'd connected to the hostname. This is
done for the initial URL *and* every redirect hop — redirects are followed
manually (`follow_redirects=False`) so each hop gets its own resolve+
validate+pin instead of letting httpx auto-follow straight to a hostname.
"""
from urllib.parse import urlparse, urlunparse

import httpx
from pydantic import BaseModel
from app.config import settings
from app.security.ssrf import SsrfError, validate_and_pin

MAX_REDIRECTS = 5
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


class FetchResult(BaseModel):
    url: str
    status: int | None = None
    ok: bool = False
    text: str = ""
    error: str | None = None


def _pinned_url(url: str, ip: str) -> str:
    """Rewrite `url` so its network-address is the already-validated IP,
    keeping scheme/path/query/fragment (and port, if explicit) intact."""
    parsed = urlparse(url)
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


async def safe_fetch(url: str, *, max_bytes: int = 2_000_000) -> FetchResult:
    current_url = url
    for _ in range(MAX_REDIRECTS + 1):
        try:
            host, ip = validate_and_pin(current_url)
        except SsrfError as e:
            return FetchResult(url=current_url, ok=False, error=str(e))

        pinned = _pinned_url(current_url, ip)
        headers = {"User-Agent": "job-hunt-verification/0.0", "Host": host}

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(
                    settings.fetch_timeout_s,
                    connect=settings.fetch_connect_timeout_s,
                ),
                follow_redirects=False,
                verify=True,
            ) as client:
                async with client.stream(
                    "GET", pinned, headers=headers,
                    extensions={"sni_hostname": host},
                ) as resp:
                    if resp.status_code in _REDIRECT_STATUSES:
                        loc = resp.headers.get("location")
                        if not loc:
                            return FetchResult(
                                url=current_url, ok=False,
                                error=f"redirect status {resp.status_code} with no Location")
                        # Resolve relative to the *original* (hostname-based)
                        # URL, not the pinned/IP one, so relative redirects
                        # stay anchored to the real host.
                        current_url = str(httpx.URL(current_url).join(loc))
                        continue

                    chunks = bytearray()
                    async for chunk in resp.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) >= max_bytes:
                            break
                    body = bytes(chunks[:max_bytes])
                    return FetchResult(
                        url=current_url, status=resp.status_code,
                        ok=resp.is_success,
                        text=body.decode(resp.encoding or "utf-8", "replace"))
        except SsrfError as e:
            return FetchResult(url=current_url, ok=False, error=f"redirect to non-public target: {e}")
        except httpx.TimeoutException:
            return FetchResult(url=current_url, ok=False, error="request timeout")
        except httpx.HTTPError as e:
            return FetchResult(url=current_url, ok=False, error=f"fetch error: {e.__class__.__name__}")

    return FetchResult(url=current_url, ok=False, error="too many redirects")
