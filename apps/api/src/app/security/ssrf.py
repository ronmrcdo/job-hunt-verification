"""SSRF guard: rejects requests to private/loopback/link-local/metadata targets.

Every outbound httpx call must pass its target through `assert_public_url`
before opening a socket, and re-check on every redirect hop (see Task 1.3).
"""
import ipaddress
import socket
from urllib.parse import urlparse


class SsrfError(ValueError):
    """URL points at a non-public or disallowed target."""


def _resolve(host: str) -> list[str]:
    # Returns every A/AAAA the host resolves to. Patched in tests.
    infos = socket.getaddrinfo(host, None)
    return [info[4][0] for info in infos]


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified
        # L5: also reject shared/CGNAT (100.64.0.0/10) and any other non-global
        # range. Additive — never weakens the explicit checks above.
        or not addr.is_global
    )


def _parse(url: str):
    # Python 3.12's urlsplit raises a bare ValueError on a bracketed netloc
    # that isn't valid IPv6. A URL we can't even parse is definitionally not a
    # valid public target, so surface it as SsrfError — the soft-failure class
    # every outbound caller already handles — instead of leaking a ValueError.
    try:
        return urlparse(url)
    except ValueError as exc:
        raise SsrfError(f"unparseable url: {url!r}") from exc


def resolve_public_ips(host: str) -> list[str]:
    host = host.strip("[]")
    try:
        addr = ipaddress.ip_address(host)
        ips = [str(addr)]
    except ValueError:
        try:
            ips = _resolve(host)
        except OSError as exc:
            raise SsrfError(f"host did not resolve: {host}") from exc
    if not ips:
        raise SsrfError(f"host did not resolve: {host}")
    for ip in ips:
        if not _is_public(ip):
            raise SsrfError(f"non-public address {ip} for host {host}")
    return ips


def assert_public_url(url: str) -> None:
    parsed = _parse(url)
    if parsed.scheme not in ("http", "https"):
        raise SsrfError(f"scheme not allowed: {parsed.scheme!r}")
    if not parsed.hostname:
        raise SsrfError("missing host")
    resolve_public_ips(parsed.hostname)


def validate_and_pin(url: str) -> tuple[str, str]:
    """Resolve + validate `url`'s host and return (hostname, validated_ip).

    Callers must connect using the returned IP directly rather than letting
    the HTTP client re-resolve the hostname later (TOCTOU / DNS-rebinding
    guard, spec §9.3) — the IP returned here is the one that was actually
    checked against the private/loopback/link-local/metadata blocklist.
    """
    parsed = _parse(url)
    if parsed.scheme not in ("http", "https"):
        raise SsrfError(f"scheme not allowed: {parsed.scheme!r}")
    if not parsed.hostname:
        raise SsrfError("missing host")
    ips = resolve_public_ips(parsed.hostname)
    return parsed.hostname, ips[0]
