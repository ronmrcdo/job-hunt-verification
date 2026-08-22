"""Deterministic URL classifier for weaponized-recruitment detection (spec §9.7).

PURE URL PARSING — no DNS, no redirects, no network of any kind. It never
resolves an attacker-controlled URL (that would re-open the SSRF surface §9.3
closes). Every decision is made on the parsed registrable domain of the link's
*true* host, with a strict allowlist for neutral classes. Anything the string
cannot pin down is `unknown`, never neutral.
"""
from dataclasses import dataclass
from urllib.parse import urlsplit
import re
import tldextract

from app.checks.domain_match import matches_any, registrable_suffix_match
from app.checks.ats_allowlist import is_ats_domain
from app.checks.homoglyph import homoglyph_hit

TARGET_KINDS = frozenset({
    "own_domain", "ats_allowlisted", "app_store",
    "off_domain", "lookalike", "direct_executable", "dangerous_scheme", "unknown",
})
_NEUTRAL = frozenset({"own_domain", "ats_allowlisted", "app_store"})
_DANGEROUS = frozenset({"off_domain", "lookalike", "direct_executable", "dangerous_scheme"})

APP_STORE_HOSTS = frozenset({
    "apps.apple.com", "itunes.apple.com", "play.google.com",
    "apps.microsoft.com", "appgallery.huawei.com",
})
SHORTENER_HOSTS = frozenset({
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd",
    "buff.ly", "rebrand.ly", "cutt.ly", "lnkd.in",
})
EXECUTABLE_EXTS = (".apk", ".exe", ".dmg", ".scr", ".msi", ".jar",
                   ".pkg", ".deb", ".sh", ".iso", ".app")
DANGEROUS_SCHEMES = frozenset({"data", "blob", "javascript", "vbscript", "file"})

_EXTRACT = tldextract.TLDExtract(suffix_list_urls=(), fallback_to_snapshot=True)
_EMBEDDED_URL = re.compile(r"https?://", re.I)


@dataclass(frozen=True)
class LinkClass:
    kind: str
    dangerous: bool
    host: str | None


def _registrable(host: str) -> str:
    ext = _EXTRACT(host.lower().rstrip("."))
    return ".".join(p for p in (ext.domain, ext.suffix) if p)


def _is_executable_path(path: str) -> bool:
    # query already excluded by urlsplit; collapse double extensions by
    # checking every trailing suffix segment.
    low = path.lower()
    return any(low.endswith(ext) for ext in EXECUTABLE_EXTS)


def classify_link(url: str, *, canonical_domain: str | None, canonical_verified: bool) -> LinkClass:
    raw = (url or "").strip()
    try:
        parts = urlsplit(raw)
    except ValueError:
        return LinkClass("unknown", False, None)

    scheme = (parts.scheme or "").lower()
    if scheme in DANGEROUS_SCHEMES:
        return LinkClass("dangerous_scheme", True, None)
    if scheme not in ("http", "https"):
        return LinkClass("unknown", False, None)

    host = (parts.hostname or "").lower()  # urlsplit strips any userinfo before '@'
    if not host:
        return LinkClass("unknown", False, None)

    # Open-redirect shape: an embedded absolute URL in query/fragment. The link
    # may bounce off a neutral host to anywhere; refuse to grant it neutrality.
    if _EMBEDDED_URL.search(parts.query or "") or _EMBEDDED_URL.search(parts.fragment or ""):
        return LinkClass("unknown", False, host)

    # Shorteners hide their true destination; never neutral, never a hit.
    if host in SHORTENER_HOSTS:
        return LinkClass("unknown", False, host)

    # Neutral allowlists (strict, registrable-domain matched).
    if canonical_verified and canonical_domain and \
            _registrable(host) == _registrable(canonical_domain):
        return LinkClass("own_domain", False, host)
    if is_ats_domain(host):
        return LinkClass("ats_allowlisted", False, host)
    if matches_any(host, APP_STORE_HOSTS):
        return LinkClass("app_store", False, host)

    # Dangerous classes.
    if _is_executable_path(parts.path or ""):
        return LinkClass("direct_executable", True, host)
    if canonical_verified and canonical_domain and homoglyph_hit(host, canonical_domain):
        return LinkClass("lookalike", True, host)
    return LinkClass("off_domain", True, host)
