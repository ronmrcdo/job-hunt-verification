"""Scan untrusted text for weaponized-recruitment links and emit findings (§9.7).

Deterministic. Runs over pasted job text (user_provided_unverified) and any
backend-fetched posting (web_verified); the classifier decides danger, this
module decides finding type, severity, and the user_safety_alert flag.
"""
import re
from html import unescape
from app.graph.state import Finding, Provenance
from app.checks.link_classifier import classify_link, LinkClass, _registrable
from app.checks.domain_match import registrable_suffix_match

_URL_RE = re.compile(r"(?:https?://|data:|blob:|javascript:)[^\s)\]}'\"<>]+", re.I)

# For fetched HTML we scan only genuine destination links — the targets of
# <a href="…"> anchors — never every URL in the markup. Namespace URIs
# (ogp.me, schema.org, w3.org/svg), JSON-LD, and <img>/<link>/<script> asset
# and CDN URLs are page machinery, not links the posting asks you to visit,
# and scanning them buries the report in false "off-domain link" findings.
_HREF_RE = re.compile(r"<a\b[^>]*?\bhref\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_SCANNED_SCHEMES = ("http://", "https://", "data:", "blob:", "javascript:")

_LOGIN_MARKERS = ("login", "log-in", "signin", "sign-in", "account", "verify",
                  "authenticate", "credential", "password")
_SIGNUP_MARKERS = ("register", "signup", "sign-up", "registration",
                   "portal", "onboard", "apply")


def extract_urls(text: str) -> list[str]:
    return _URL_RE.findall(text or "")


def extract_anchor_urls(html: str) -> list[str]:
    """The `href` targets of <a> anchors in fetched HTML — the links a reader
    can actually click — restricted to scannable schemes. Relative, fragment,
    and `mailto:` hrefs (same-origin navigation or non-web) are dropped."""
    out: list[str] = []
    for raw in _HREF_RE.findall(html or ""):
        url = unescape(raw.strip().strip("\"'").strip())
        if url.lower().startswith(_SCANNED_SCHEMES):
            out.append(url)
    return out


def _ask_type(url: str, kind: str) -> str:
    low = url.lower()
    if kind == "direct_executable":
        return "app_download_ask"
    if any(m in low for m in _LOGIN_MARKERS):
        return "credential_login_ask"
    if any(m in low for m in _SIGNUP_MARKERS):
        return "portal_signup_ask"
    if kind == "lookalike":            # a lookalike host is almost always credential phishing
        return "credential_login_ask"
    return "off_domain_link"


def _finding_for(url: str, lc: LinkClass, ask: str, provenance: Provenance, fid: str,
                  source_ids: list[str] | None) -> Finding | None:
    if lc.kind in ("own_domain", "ats_allowlisted", "app_store"):
        return None  # §7 false-positive guard: neutral links are never findings

    if lc.kind == "unknown":
        return Finding(id=fid, category="communication", direction="suspicious",
                       severity="low", provenance=provenance, user_safety_alert=False,
                       claim=f"The posting contains a link we could not verify ({url}); "
                             "verify any link before you log in or download.",
                       source_ids=source_ids or [])

    if ask == "app_download_ask":
        claim = f"The posting asks you to download and run software ({url})."
    elif ask == "credential_login_ask":
        detail = "a lookalike of the company's verified domain" if lc.kind == "lookalike" \
            else "a site that is not the company's own domain"
        claim = f"The posting asks you to log in on {detail} ({url})."
    elif ask == "portal_signup_ask":
        claim = f"The posting asks you to register on a third-party site ({url})."
    else:
        claim = f"The posting links to a site that is not the company's own domain ({url})."

    if ask == "portal_signup_ask":
        severity, alert = "medium", False
    else:
        severity, alert = "high", True

    return Finding(id=fid, category="communication", direction="suspicious",
                   severity=severity, provenance=provenance,
                   user_safety_alert=alert, claim=claim, source_ids=source_ids or [])


def scan_links(text: str, *, provenance: Provenance, canonical_domain: str | None,
               canonical_verified: bool, id_prefix: str = "linkscan",
               source_ids: list[str] | None = None,
               html: bool = False, page_domain: str | None = None) -> list[Finding]:
    """Scan `text` for weaponized-recruitment links.

    Pasted job text is scanned as-is — every URL in it was authored by the
    poster. A fetched page (`html=True`) is HTML markup, so only <a href>
    destinations are scanned; and same-site links back into `page_domain`
    (the fetched page's own registrable domain) are navigation, not a signal,
    and are suppressed — except a runnable download or dangerous scheme, which
    stays a finding even on the page's own host."""
    urls = extract_anchor_urls(text) if html else extract_urls(text)
    page_reg = _registrable(page_domain) if page_domain else None
    out: list[Finding] = []
    for i, url in enumerate(urls):
        lc = classify_link(url, canonical_domain=canonical_domain,
                           canonical_verified=canonical_verified)
        if lc.kind == "off_domain" and page_reg and lc.host \
                and registrable_suffix_match(lc.host, page_reg):
            continue  # same-site navigation on the fetched page — not a §9.7 ask
        ask = _ask_type(url, lc.kind)
        f = _finding_for(url, lc, ask, provenance, fid=f"{id_prefix}_{i}", source_ids=source_ids)
        if f is not None:
            out.append(f)
    return out
