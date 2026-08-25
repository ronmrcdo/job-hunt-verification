"""RDAP domain-age lookup.

Uses the SSRF-safe fetcher (Task 1.3) to query rdap.org for a domain's
registration event and derive its age in days. Any failure — network,
non-2xx status, malformed JSON, missing/unparseable registration date —
is a soft "unavailable" (None), never treated as a suspicious signal
(spec §7).
"""
import json
from datetime import date, datetime
from urllib.parse import quote
from app.tools.fetcher import safe_fetch


async def domain_age_days(domain: str, *, today: date) -> int | None:
    res = await safe_fetch(f"https://rdap.org/domain/{quote(domain, safe='')}")
    if not res.ok:
        return None
    try:
        data = json.loads(res.text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    for event in data.get("events", []):
        if event.get("eventAction") == "registration":
            raw = event.get("eventDate")
            if not isinstance(raw, str):
                return None
            try:
                reg = datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
            except ValueError:
                return None
            return (today - reg).days
    return None
