"""Output-safety primitives: URL defanging and accusation-language detection (spec §9.5).

Defanged URLs prevent report renderers from hyperlinking the thing being
warned about. Accusation patterns back the declarative-language linter that
keeps reports in "signals observed" phrasing rather than asserting guilt.
"""

import re
from urllib.parse import urlparse

ACCUSATION_PATTERNS = [
    re.compile(r"\bis (a |an )?(scam|fraud|fraudulent|phishing operation)\b", re.I),
    re.compile(r"\bis (definitely |clearly |obviously )?(scamming|defrauding)\b", re.I),
    re.compile(r"\b(scammed|defrauded) (you|applicants|people)\b", re.I),
]


def contains_accusation(text: str) -> bool:
    return any(p.search(text or "") for p in ACCUSATION_PATTERNS)


def defang_url(url: str) -> str:
    out = url.replace("https://", "hxxps://").replace("http://", "hxxp://")
    parsed = urlparse(url)
    if parsed.hostname:
        out = out.replace(parsed.hostname, parsed.hostname.replace(".", "[.]"))
    return out
