"""RDAP domain-age lookup.

Uses the SSRF-safe fetcher (Task 1.3) to query rdap.org for a domain's
registration event and derive its age in days. Any failure — network,
non-2xx status, malformed JSON, missing/unparseable registration date —
is a soft "unavailable" (None), never treated as a suspicious signal
(spec §7).
"""
import json
from datetime import date, datetime
from app.tools.fetcher import safe_fetch


async def domain_age_days(domain: str, *, today: date) -> int | None:
    res = await safe_fetch(f"https://rdap.org/domain/{domain}")
    if not res.ok:
        return None
    try:
        data = json.loads(res.text)
    except json.JSONDecodeError:
        return None
    for event in data.get("events", []):
        if event.get("eventAction") == "registration":
            try:
                reg = datetime.fromisoformat(event["eventDate"].replace("Z", "+00:00")).date()
            except (KeyError, ValueError):
                return None
            return (today - reg).days
    return None
