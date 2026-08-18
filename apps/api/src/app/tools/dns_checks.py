"""Keyless DNS MX checks.

`has_valid_mx` distinguishes "domain resolved but has no MX" (False)
from "lookup failed" (None, e.g. DNS server unreachable). A failed
lookup is never treated as a suspicious signal (spec §7).
"""
import asyncio
import dns.resolver


def _resolve_mx(domain: str) -> list[str]:
    answers = dns.resolver.resolve(domain, "MX")
    return [str(r.exchange) for r in answers]


async def has_valid_mx(domain: str) -> bool | None:
    try:
        records = await asyncio.to_thread(_resolve_mx, domain)
        return len(records) > 0
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        return False
    except Exception:
        return None
