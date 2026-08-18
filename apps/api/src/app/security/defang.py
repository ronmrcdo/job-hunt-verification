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


_SCHEME_RE = re.compile(r"^https?://", re.I)


def _defang_scheme(match: re.Match) -> str:
    return "hxxps://" if match.group(0).lower() == "https://" else "hxxp://"


def defang_url(url: str) -> str:
    out = _SCHEME_RE.sub(_defang_scheme, url)
    parsed = urlparse(url)
    if parsed.hostname:
        # urlparse always lowercases parsed.hostname, but the host may appear
        # in the original (possibly mixed-case) url in its own casing --
        # e.g. "https://EVIL.com/x". A case-sensitive literal replace on
        # parsed.hostname would silently no-op there, leaving the host
        # un-bracketed. Bracket the host as it actually appears, matched
        # case-insensitively.
        host_re = re.compile(re.escape(parsed.hostname), re.I)
        out = host_re.sub(lambda m: m.group(0).replace(".", "[.]"), out)
    return out


_URL_RE = re.compile(r"https?://[^\s)\]}'\"<>]+", re.IGNORECASE)


def _defang_match(match: re.Match) -> str:
    return defang_url(match.group(0))


def defang_text(text: str) -> str:
    """Defang every http(s) URL embedded in free text. Shared by the report
    node (summary/checklist) and any node that must scrub URLs out of
    attacker-influenced finding claims before they reach the response."""
    return _URL_RE.sub(_defang_match, text or "")
