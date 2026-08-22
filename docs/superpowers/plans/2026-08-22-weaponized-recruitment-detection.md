# Weaponized-Recruitment Detection (§9.7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect malware-download and credential-phishing asks in job postings (§9.7) and surface them as a provenance-gated user-safety callout, without ever letting an unverified paste defame a named company.

**Architecture:** A new pure URL classifier (`checks/link_classifier.py`) + link-to-finding mapper (`checks/link_scan.py`) feed a new deterministic fan-out node (`linkscan_node.py`) that scans pasted job text (`user_provided_unverified`) and any backend-fetched posting (`web_verified`). Findings carry a new `Finding.user_safety_alert` flag. The rubric gains a credential-lookalike HIGH floor (verified-reference-gated) and a Gap-B precondition that keeps deterministic-on-user-entity signals from moving a named company's band until research confirms domain ownership. A new `verified_canonical_domain` on state — populated by research — becomes the single trusted reference for both the homoglyph check (Gap A) and the credential floor (S5). The report node renders the callout entity-decoupled for unverified asks.

**Tech Stack:** Python 3.12, Pydantic v2, LangGraph, pytest + pytest-asyncio, `tldextract` (offline PSL snapshot), `urllib.parse`. All new code is deterministic (no LLM, no network in the classifier).

**Spec:** `docs/superpowers/specs/2026-08-18-job-hunt-verification-design.md` (§9.7, §5, §4, §7, §9.1, §10)

## Global Constraints

- **No LLM, no network in the link classifier** — pure URL parsing only (spec §9.7, §9.3). It must never resolve DNS or follow redirects.
- **Registrable-domain matching only** — all host allowlist/denylist decisions go through `app.checks.domain_match.registrable_suffix_match` / `matches_any` (never substring/path/query).
- **Provenance keys on who fetched the content** (spec §4, revised): pasted `submission.job_text` → `provenance="user_provided_unverified"`; `state.fetched_posting` (backend-fetched) → `provenance="web_verified"`. Never trust a pasted posting as verified.
- **Fan-out nodes write additive accumulators only** — `raw_findings` / `raw_sources` (both `Annotated[..., operator.add]`); never write `findings`/`sources` from a branch (spec §3, `state.py:66-76`).
- **Reuse existing helpers** — `is_ats_domain`, `homoglyph_hit`, `registrable_suffix_match`, `defang_text`. Do not duplicate (global rule: one clean version of each thing).
- **`target_kind` vocabulary** (spec §9.7): `own_domain` / `ats_allowlisted` / `app_store` (neutral) · `off_domain` / `lookalike` / `direct_executable` / `dangerous_scheme` (dangerous, set `user_safety_alert`) · `unknown` (soft signal only, never an alert).
- **Executable extensions:** `.apk .exe .dmg .scr .msi .jar .pkg .deb .sh .iso .app` — evaluated on the path with query stripped and double-extensions collapsed.
- Run tests from `apps/api/` with `uv run pytest`. Async tests use `@pytest.mark.asyncio`.
- Commit steps are intentionally omitted from this plan (project convention).

---

## File Structure

**New files:**
- `apps/api/src/app/checks/link_classifier.py` — pure `classify_link(url, *, canonical_domain, canonical_verified) -> LinkClass`.
- `apps/api/src/app/checks/link_scan.py` — `extract_urls(text)` + `scan_links(text, *, provenance, canonical_domain, canonical_verified) -> list[Finding]`.
- `apps/api/src/app/graph/nodes/linkscan_node.py` — fan-out node wrapping `scan_links` over job text + fetched posting.
- `apps/api/tests/checks/test_link_classifier.py`
- `apps/api/tests/checks/test_link_scan.py`
- `apps/api/tests/graph/nodes/test_linkscan_node.py`

**Modified files:**
- `apps/api/src/app/graph/state.py` — add `Finding.user_safety_alert`; add `InvestigationState.verified_canonical_domain`.
- `apps/api/src/app/graph/build.py` — add `linkscan` to the fan-out.
- `apps/api/src/app/graph/nodes/research.py` — populate `verified_canonical_domain` on authoritative corroboration.
- `apps/api/src/app/graph/nodes/evidence.py` — thread `verified_canonical_domain` through the fan-in barrier.
- `apps/api/src/app/checks/deterministic.py` + `graph/nodes/checks_node.py` — gate homoglyph reference on verification (Gap A); expose `entity_ownership_confirmed`.
- `apps/api/src/app/rubric.py` — credential-lookalike HIGH floor (S5); Gap-B precondition.
- `apps/api/src/app/graph/nodes/report.py` — provenance-gated, defanged safety callout.
- `apps/api/eval/dataset.json` + `apps/api/eval/test_eval.py` — §9.7 + evasion + sabotage cases.

---

## Phase 1 — Schema field + pure URL classifier

Delivers the `user_safety_alert` field and the deterministic classifier that every later phase depends on. This is the security-critical core: the evasion eval cases (spec §10) are its acceptance tests.

### Task 1.1: Add `user_safety_alert` to `Finding`

**Files:**
- Modify: `apps/api/src/app/graph/state.py:42-50`
- Test: `apps/api/tests/graph/test_state.py`

**Interfaces:**
- Produces: `Finding.user_safety_alert: bool` (default `False`).

- [ ] **Step 1: Write the failing test**

```python
# tests/graph/test_state.py  (add)
from app.graph.state import Finding

def test_finding_user_safety_alert_defaults_false():
    f = Finding(id="x", category="communication", direction="suspicious",
                severity="high", claim="c", provenance="user_provided_unverified")
    assert f.user_safety_alert is False

def test_finding_user_safety_alert_settable():
    f = Finding(id="x", category="communication", direction="suspicious",
                severity="high", claim="c", provenance="web_verified",
                user_safety_alert=True)
    assert f.user_safety_alert is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/test_state.py -v -k user_safety_alert`
Expected: FAIL — `Finding` has no field `user_safety_alert` (Pydantic rejects the kwarg).

- [ ] **Step 3: Implement**

In `state.py`, add to `Finding` after `mitigation`:

```python
    mitigation: str | None = None
    # §9.7: this finding is a request for the user to take a compromising
    # action (run an executable, log in on a non-company site). Surfaces as an
    # unconditional safety callout; never raises the named company's band.
    user_safety_alert: bool = False
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/graph/test_state.py -v -k user_safety_alert`
Expected: PASS

### Task 1.2: `classify_link` — pure classifier

**Files:**
- Create: `apps/api/src/app/checks/link_classifier.py`
- Test: `apps/api/tests/checks/test_link_classifier.py`

**Interfaces:**
- Consumes: `app.checks.domain_match.matches_any/registrable_suffix_match`, `app.checks.ats_allowlist.is_ats_domain`, `app.checks.homoglyph.homoglyph_hit`.
- Produces: `TARGET_KINDS: frozenset[str]`; `LinkClass(kind: str, dangerous: bool, host: str | None)`; `classify_link(url: str, *, canonical_domain: str | None, canonical_verified: bool) -> LinkClass`.

- [ ] **Step 1: Write the failing test** (these are the spec §10 evasion cases)

```python
# tests/checks/test_link_classifier.py
from app.checks.link_classifier import classify_link, LinkClass

def c(url, dom="acme.com", verified=True):
    return classify_link(url, canonical_domain=dom, canonical_verified=verified)

def test_own_domain_neutral():
    assert c("https://acme.com/careers/login").kind == "own_domain"

def test_ats_host_neutral():
    assert c("https://acme.greenhouse.io/apply").kind == "ats_allowlisted"

def test_official_app_store_neutral():
    assert c("https://play.google.com/store/apps/details?id=x").kind == "app_store"

def test_direct_executable_dangerous():
    r = c("https://acme-corp-onboard.com/app.apk")
    assert r.kind == "direct_executable" and r.dangerous is True

def test_executable_with_query_stripped():
    assert c("https://x.io/setup.exe?ref=1").kind == "direct_executable"

def test_double_extension_executable():
    assert c("https://x.io/invoice.pdf.scr").kind == "direct_executable"

def test_lookalike_login_when_verified():
    r = c("https://acme-corp.com/login", dom="acme.com", verified=True)
    # acme-corp vs acme is >2 edits; use a real lookalike:
    r = c("https://acme-globall.com/login", dom="acme-global.com", verified=True)
    assert r.kind == "lookalike" and r.dangerous is True

def test_lookalike_not_flagged_when_reference_unverified():
    r = c("https://acme-globall.com/login", dom="acme-global.com", verified=False)
    assert r.kind == "off_domain"  # cannot claim lookalike without a verified ref (S5/Gap A)

def test_open_redirect_on_allowlisted_host_is_unknown():
    # embedded absolute URL in query -> never inherits greenhouse.io's neutral class
    assert c("https://greenhouse.io/redirect?url=https://evil-login.com").kind == "unknown"

def test_userinfo_confusion_uses_real_host():
    # real host is evil.com, not greenhouse.io
    r = c("https://greenhouse.io@evil.com/login")
    assert r.kind in ("off_domain", "lookalike") and r.host == "evil.com"

def test_app_store_lookalike_host_is_not_neutral():
    # play.google.com.evil.com registrable = evil.com -> executable path -> danger
    assert c("https://play.google.com.evil.com/app.apk").kind == "direct_executable"

def test_ats_name_in_path_is_not_neutral():
    r = c("https://evil.com/greenhouse.io/login")
    assert r.kind != "ats_allowlisted"

def test_shortener_is_unknown():
    assert c("https://bit.ly/3xyz").kind == "unknown"

def test_data_uri_is_dangerous_scheme():
    r = c("data:text/html;base64,PGZvcm0+")
    assert r.kind == "dangerous_scheme" and r.dangerous is True

def test_javascript_scheme_is_dangerous():
    assert c("javascript:steal()").kind == "dangerous_scheme"

def test_unparseable_is_unknown():
    assert c("not a url").kind == "unknown"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/checks/test_link_classifier.py -v`
Expected: FAIL — module `link_classifier` does not exist.

- [ ] **Step 3: Implement**

```python
# src/app/checks/link_classifier.py
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/checks/test_link_classifier.py -v`
Expected: PASS (all evasion cases green).

---

## Phase 2 — Link scan → findings

Turns classified links into `Finding`s with correct type, severity, direction, and `user_safety_alert`, given a provenance. Pure and fully unit-testable.

### Task 2.1: `extract_urls`

**Files:**
- Create: `apps/api/src/app/checks/link_scan.py`
- Test: `apps/api/tests/checks/test_link_scan.py`

**Interfaces:**
- Produces: `extract_urls(text: str) -> list[str]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/checks/test_link_scan.py
from app.checks.link_scan import extract_urls

def test_extracts_http_urls():
    urls = extract_urls("apply at https://x.io/a and http://y.io/b now")
    assert urls == ["https://x.io/a", "http://y.io/b"]

def test_extracts_data_uri():
    assert "data:text/html;base64,AAA" in extract_urls("see data:text/html;base64,AAA end")

def test_no_urls():
    assert extract_urls("no links here") == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/checks/test_link_scan.py::test_extracts_http_urls -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```python
# src/app/checks/link_scan.py  (top)
"""Scan untrusted text for weaponized-recruitment links and emit findings (§9.7).

Deterministic. Runs over pasted job text (user_provided_unverified) and any
backend-fetched posting (web_verified); the classifier decides danger, this
module decides finding type, severity, and the user_safety_alert flag.
"""
import re
from app.graph.state import Finding, Provenance
from app.checks.link_classifier import classify_link, LinkClass

_URL_RE = re.compile(r"(?:https?://|data:|blob:|javascript:)[^\s)\]}'\"<>]+", re.I)

_LOGIN_MARKERS = ("login", "log-in", "signin", "sign-in", "account", "verify",
                  "authenticate", "credential", "password")
_SIGNUP_MARKERS = ("register", "signup", "sign-up", "registration",
                   "portal", "onboard", "apply")


def extract_urls(text: str) -> list[str]:
    return _URL_RE.findall(text or "")
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/checks/test_link_scan.py -v`
Expected: PASS

### Task 2.2: `scan_links` — findings with provenance + alert

**Files:**
- Modify: `apps/api/src/app/checks/link_scan.py`
- Test: `apps/api/tests/checks/test_link_scan.py`

**Interfaces:**
- Consumes: `classify_link` (Task 1.2), `Finding` (Task 1.1).
- Produces: `scan_links(text: str, *, provenance: Provenance, canonical_domain: str | None, canonical_verified: bool, id_prefix: str = "linkscan") -> list[Finding]`.

- [ ] **Step 1: Write the failing test**

```python
def _scan(text, prov="user_provided_unverified", dom="acme.com", verified=True):
    from app.checks.link_scan import scan_links
    return scan_links(text, provenance=prov, canonical_domain=dom, canonical_verified=verified)

def test_executable_download_is_alert_high():
    fs = _scan("install our app: https://x.io/app.apk")
    assert len(fs) == 1
    f = fs[0]
    assert f.severity == "high" and f.user_safety_alert is True
    assert f.direction == "suspicious" and f.category == "communication"
    assert "download" in f.claim.lower()
    assert f.provenance == "user_provided_unverified"

def test_own_domain_login_emits_no_finding():
    assert _scan("log in at https://acme.com/login") == []

def test_ats_signup_emits_no_finding():
    assert _scan("register at https://acme.greenhouse.io/apply") == []

def test_offdomain_login_is_alert():
    fs = _scan("verify identity: https://acme-verify-portal.io/login")
    assert fs and fs[0].user_safety_alert is True and "login" in fs[0].claim.lower()

def test_lookalike_login_web_verified_marks_lookalike_claim():
    fs = _scan("log in https://acme-globall.com/login", prov="web_verified",
               dom="acme-global.com", verified=True)
    assert fs and "lookalike" in fs[0].claim.lower() and fs[0].provenance == "web_verified"

def test_unknown_link_is_soft_no_alert():
    fs = _scan("continue: https://bit.ly/x")
    assert fs and fs[0].user_safety_alert is False and fs[0].severity in ("info", "low")

def test_signup_offdomain_is_soft():
    fs = _scan("sign up at https://third-party-jobs.io/register")
    assert fs and fs[0].severity in ("low", "medium")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/checks/test_link_scan.py -v -k scan or download or login`
Expected: FAIL — `scan_links` undefined.

- [ ] **Step 3: Implement** (append to `link_scan.py`)

```python
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


def _finding_for(url: str, lc: LinkClass, ask: str, provenance: Provenance, fid: str) -> Finding | None:
    if lc.kind in ("own_domain", "ats_allowlisted", "app_store"):
        return None  # §7 false-positive guard: neutral links are never findings

    if lc.kind == "unknown":
        return Finding(id=fid, category="communication", direction="suspicious",
                       severity="low", provenance=provenance, user_safety_alert=False,
                       claim=f"The posting contains a link we could not verify ({url}); "
                             "verify any link before you log in or download.")

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
                   user_safety_alert=alert, claim=claim)


def scan_links(text: str, *, provenance: Provenance, canonical_domain: str | None,
               canonical_verified: bool, id_prefix: str = "linkscan") -> list[Finding]:
    out: list[Finding] = []
    for i, url in enumerate(extract_urls(text)):
        lc = classify_link(url, canonical_domain=canonical_domain,
                           canonical_verified=canonical_verified)
        ask = _ask_type(url, lc.kind)
        f = _finding_for(url, lc, ask, provenance, fid=f"{id_prefix}_{i}")
        if f is not None:
            out.append(f)
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/checks/test_link_scan.py -v`
Expected: PASS

---

## Phase 3 — Link-scan node + graph wiring

Adds the deterministic fan-out branch that runs the scan over pasted job text (unverified) and the fetched posting (verified), and wires it into the compiled graph beside the other branches.

### Task 3.1: `linkscan_node`

**Files:**
- Create: `apps/api/src/app/graph/nodes/linkscan_node.py`
- Test: `apps/api/tests/graph/nodes/test_linkscan_node.py`

**Interfaces:**
- Consumes: `scan_links` (Task 2.2), `InvestigationState`.
- Produces: `async def linkscan_node(state) -> dict` returning `{"raw_findings": [...]}` (additive).

- [ ] **Step 1: Write the failing test**

```python
# tests/graph/nodes/test_linkscan_node.py
import pytest
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities
from app.graph.nodes.linkscan_node import linkscan_node

@pytest.mark.asyncio
async def test_pasted_download_is_user_provided_alert():
    state = InvestigationState(
        submission=RawSubmission(job_text="install https://x.io/app.apk", company_name="Acme"),
        entities=ExtractedEntities(company_name="Acme"))
    out = await linkscan_node(state)
    fs = out["raw_findings"]
    assert fs and fs[0].user_safety_alert is True
    assert fs[0].provenance == "user_provided_unverified"

@pytest.mark.asyncio
async def test_fetched_posting_link_is_web_verified():
    state = InvestigationState(
        submission=RawSubmission(job_text="see details"),
        fetched_posting="download https://x.io/setup.exe",
        verified_canonical_domain="acme.com",
        entities=ExtractedEntities(company_name="Acme"))
    out = await linkscan_node(state)
    fs = [f for f in out["raw_findings"] if f.provenance == "web_verified"]
    assert fs and fs[0].user_safety_alert is True

@pytest.mark.asyncio
async def test_no_links_no_findings():
    state = InvestigationState(submission=RawSubmission(job_text="clean posting"))
    assert await linkscan_node(state) == {"raw_findings": []}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/nodes/test_linkscan_node.py -v`
Expected: FAIL — module missing (and `verified_canonical_domain` not yet on state; add it in Task 3.3, so run this after 3.3 if it errors on the kwarg — or add the field first).

- [ ] **Step 3: Implement**

```python
# src/app/graph/nodes/linkscan_node.py
"""Weaponized-recruitment link-scan node (spec §9.7).

Deterministic fan-out branch. Scans the pasted posting (user_provided_unverified)
and any backend-fetched posting (web_verified) for download/login/sign-up links.
The reference domain is `verified_canonical_domain` — only a research-confirmed
domain (never the LLM-extracted `candidate_real_domain`) is trusted enough to
call something a lookalike (spec §9.7 Gap A / S5).
"""
from app.graph.state import InvestigationState
from app.checks.link_scan import scan_links


async def linkscan_node(state: InvestigationState) -> dict:
    ref = state.verified_canonical_domain
    verified = ref is not None
    findings = []
    findings += scan_links(state.submission.job_text or "",
                           provenance="user_provided_unverified",
                           canonical_domain=ref, canonical_verified=verified,
                           id_prefix="linkscan_paste")
    if state.fetched_posting:
        findings += scan_links(state.fetched_posting,
                               provenance="web_verified",
                               canonical_domain=ref, canonical_verified=verified,
                               id_prefix="linkscan_fetched")
    return {"raw_findings": findings}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/graph/nodes/test_linkscan_node.py -v`
Expected: PASS

### Task 3.2: Wire `linkscan` into the fan-out

**Files:**
- Modify: `apps/api/src/app/graph/build.py:111-134`
- Test: `apps/api/tests/graph/test_build.py`

**Interfaces:**
- Consumes: `linkscan_node` (Task 3.1), existing `_with_branch_guard`.

- [ ] **Step 1: Write the failing test**

```python
# tests/graph/test_build.py  (add)
def test_linkscan_branch_in_graph():
    from app.graph.build import build_graph  # match existing import in this file
    g = build_graph()
    assert "linkscan" in g.nodes
```

(If `test_build.py` compiles the graph differently, mirror its existing pattern — reuse the helper/fixture already there rather than calling `build_graph` directly.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/test_build.py -v -k linkscan`
Expected: FAIL — no `linkscan` node.

- [ ] **Step 3: Implement**

In `build.py`, add the import near the other node imports (line ~29-33):

```python
from app.graph.nodes.linkscan_node import linkscan_node
```

Register the node beside `checks` (after line 120):

```python
    g.add_node("linkscan", _with_branch_guard(
        linkscan_node, name="weaponized_link_scan", category="communication"))
```

Add it to the fan-out tuple (line 132):

```python
    for branch in ("checks", "research", "crosspost", "conversation", "linkscan"):
        g.add_edge("intake", branch)
        g.add_edge(branch, "evidence")          # fan-in barrier
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/graph/test_build.py -v`
Expected: PASS

### Task 3.3: Add `verified_canonical_domain` to state

**Files:**
- Modify: `apps/api/src/app/graph/state.py:58-80`
- Test: `apps/api/tests/graph/test_state.py`

**Interfaces:**
- Produces: `InvestigationState.verified_canonical_domain: str | None` (default `None`).

- [ ] **Step 1: Write the failing test**

```python
def test_verified_canonical_domain_defaults_none():
    from app.graph.state import InvestigationState, RawSubmission
    s = InvestigationState(submission=RawSubmission(job_text="x"))
    assert s.verified_canonical_domain is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/test_state.py -v -k verified_canonical`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `state.py`, add to `InvestigationState` after `fetched_posting`:

```python
    # A company domain corroborated by a backend-fetched authoritative source
    # (research disambiguation, spec §7). This — never the LLM-extracted
    # candidate_real_domain — is the reference the homoglyph check and the
    # §9.7 credential floor trust (Gap A / S5). None until research confirms it.
    verified_canonical_domain: str | None = None
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/graph/test_state.py -v -k verified_canonical`
Expected: PASS. Re-run Task 3.1 tests — now green with the kwarg.

---

## Phase 4 — Web-verified canonical domain (Gap A)

Research populates `verified_canonical_domain` when a fetched, relevant source corroborates the company's domain; the homoglyph check stops trusting the LLM-extracted reference. Closes the live Gap A in `intake.py`/`deterministic.py`.

### Task 4.1: Research emits a verified canonical domain

**Files:**
- Modify: `apps/api/src/app/graph/nodes/research.py`
- Modify: `apps/api/src/app/graph/nodes/evidence.py` (thread the field through the fan-in)
- Test: `apps/api/tests/graph/nodes/test_evidence.py` (or the research test file if one exists)

**Interfaces:**
- Produces: `company_research` returns `verified_canonical_domain` in its dict when a relevant source confirms the submitted `company_domain`; `evidence_assembly` preserves it onto the merged state.

- [ ] **Step 1: Write the failing test**

```python
# reuse the research node's existing test conventions; sketch:
import pytest
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities

@pytest.mark.asyncio
async def test_research_confirms_domain_when_relevant_source_matches(monkeypatch):
    # Arrange a fake summarizer that returns a relevant source whose page
    # corroborates acme.com as the company's domain, then assert:
    #   out["verified_canonical_domain"] == "acme.com"
    ...
```

Implementer: model this on the existing research test (`_summarize_hit` is monkeypatched). The confirmation rule: `verified_canonical_domain = entities.company_domain` **iff** at least one `relevant=True` source's host registrable-matches `entities.company_domain`. Keep it conservative — a same-named-but-different entity (`relevant=False`) must not confirm.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/nodes/ -v -k confirms_domain`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `research.py`, after summarizing hits, compute:

```python
from app.checks.domain_match import registrable_suffix_match

def _confirm_canonical(entities, sources) -> str | None:
    dom = (entities.company_domain or "").lower() or None
    if not dom:
        return None
    for s in sources:
        host = (urlsplit(s.url).hostname or "").lower() if s.url else ""
        if host and registrable_suffix_match(host, dom):
            return dom
    return None
```

Return `{"raw_sources": [...], "verified_canonical_domain": _confirm_canonical(entities, relevant_sources), ...}`. In `evidence.py`, carry `verified_canonical_domain` from the incoming state through to the returned dict so the fan-in preserves it (it is a scalar, not an accumulator — last-writer wins is fine; only research sets it).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/graph/nodes/ -v -k "confirms_domain or evidence"`
Expected: PASS

### Task 4.2: Homoglyph check trusts only the verified reference (Gap A)

**Files:**
- Modify: `apps/api/src/app/checks/deterministic.py:38-57`
- Modify: `apps/api/src/app/graph/nodes/checks_node.py`
- Test: `apps/api/tests/checks/test_deterministic.py`, `apps/api/tests/graph/nodes/test_checks_node.py`

**Interfaces:**
- Consumes: `verified_canonical_domain` via the node.
- Produces: `run_deterministic_checks(entities, *, today, verified_canonical_domain)` — `homoglyph_hit` is only `True/False` when a verified reference exists; otherwise `"unknown"`. Also returns `entity_ownership_confirmed: bool`.

- [ ] **Step 1: Write the failing test**

```python
# tests/checks/test_deterministic.py  (add)
import pytest
from datetime import date
from app.checks.deterministic import run_deterministic_checks
from app.graph.state import ExtractedEntities

@pytest.mark.asyncio
async def test_homoglyph_unknown_without_verified_reference(monkeypatch):
    monkeypatch.setattr("app.checks.deterministic.domain_age_days",
                        lambda *a, **k: __import__("asyncio").sleep(0, result=900))
    monkeypatch.setattr("app.checks.deterministic.has_valid_mx",
                        lambda *a, **k: __import__("asyncio").sleep(0, result=True))
    e = ExtractedEntities(company_domain="acme-globall.com", candidate_real_domain="acme-global.com")
    sig = await run_deterministic_checks(e, today=date(2026, 8, 22), verified_canonical_domain=None)
    assert sig["homoglyph_hit"] == "unknown"
    assert sig["entity_ownership_confirmed"] is False

@pytest.mark.asyncio
async def test_homoglyph_hit_with_verified_reference(monkeypatch):
    monkeypatch.setattr("app.checks.deterministic.domain_age_days",
                        lambda *a, **k: __import__("asyncio").sleep(0, result=900))
    monkeypatch.setattr("app.checks.deterministic.has_valid_mx",
                        lambda *a, **k: __import__("asyncio").sleep(0, result=True))
    e = ExtractedEntities(company_domain="acme-globall.com")
    sig = await run_deterministic_checks(e, today=date(2026, 8, 22),
                                         verified_canonical_domain="acme-global.com")
    assert sig["homoglyph_hit"] is True
    assert sig["entity_ownership_confirmed"] is False  # submitted != verified
```

(Match the file's existing monkeypatch idiom for the async `domain_age_days`/`has_valid_mx` — the sketch above shows intent; use whatever `test_deterministic.py` already uses.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/checks/test_deterministic.py -v -k homoglyph`
Expected: FAIL — signature has no `verified_canonical_domain`; `homoglyph_hit` is a bool, not `"unknown"`.

- [ ] **Step 3: Implement**

`deterministic.py` — replace the reference source and homoglyph line:

```python
async def run_deterministic_checks(entities, *, today, verified_canonical_domain=None):
    company_domain = (entities.company_domain or "").lower() or None
    email_domain = _email_domain(entities.recruiter_email)
    ref = (verified_canonical_domain or "").lower() or None

    ...
    if company_domain is None:
        homoglyph = False
    elif ref is None:
        homoglyph = "unknown"            # Gap A: no verified reference -> not a hit
    else:
        homoglyph = homoglyph_hit(company_domain, ref)

    ownership_confirmed = bool(ref and company_domain and
                               registrable_suffix_match(company_domain, ref))

    return {
        ...
        "homoglyph_hit": homoglyph,
        "entity_ownership_confirmed": ownership_confirmed,
        ...
    }
```

Import `registrable_suffix_match` at top. In `checks_node.py`, pass `verified_canonical_domain=state.verified_canonical_domain` into `run_deterministic_checks`, and change the homoglyph finding guard to fire only on an explicit `True`:

```python
    if sig["homoglyph_hit"] is True:
        findings.append(Finding(... unchanged ...))
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/checks/test_deterministic.py tests/graph/nodes/test_checks_node.py -v`
Expected: PASS. **Update the existing `test_checks_node.py::test_homoglyph_produces_suspicious_finding`** to pass `verified_canonical_domain="acme-global.com"` on the state and a `homoglyph_hit: True` fake — otherwise it now correctly produces no finding.

---

## Phase 5 — Rubric: credential floor (S5) + Gap-B precondition

The rubric gains the credential-lookalike HIGH floor (only against a verified reference) and the rule that deterministic-on-user-entity signals cannot move a *named* company's band until ownership is confirmed. Includes the V0 sabotage regression.

### Task 5.1: Credential-lookalike HIGH floor (verified only)

**Files:**
- Modify: `apps/api/src/app/rubric.py`
- Test: `apps/api/tests/test_rubric.py`

**Interfaces:**
- Consumes: `Finding.user_safety_alert`, `Finding.provenance`, `Finding.claim`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_rubric.py  (add)
from app.graph.state import InvestigationState, RawSubmission, ExtractedEntities, Finding
from app.rubric import compute_assessment

def _state(findings, signals=None, company="Acme"):
    return InvestigationState(
        submission=RawSubmission(job_text="x"),
        entities=ExtractedEntities(company_name=company),
        findings=findings, deterministic_signals=signals or {})

def test_web_verified_lookalike_login_floors_high():
    f = Finding(id="l", category="communication", direction="suspicious", severity="high",
                claim="The posting asks you to log in on a lookalike of the company's verified domain (x).",
                provenance="web_verified", user_safety_alert=True)
    a = compute_assessment(_state([f]))
    assert a.band in ("HIGH", "CRITICAL")

def test_user_provided_lookalike_login_capped_moderate_for_named_company():
    f = Finding(id="l", category="communication", direction="suspicious", severity="high",
                claim="The posting asks you to log in on a lookalike ... (x).",
                provenance="user_provided_unverified", user_safety_alert=True)
    a = compute_assessment(_state([f]))
    assert a.band == "MODERATE"   # §9.1: unverified alone cannot exceed MODERATE for a named company
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/test_rubric.py -v -k lookalike`
Expected: `test_web_verified_lookalike_login_floors_high` FAILS (band computes MODERATE/LOW without the floor); the capped one may already pass via the existing §9.1 rule.

- [ ] **Step 3: Implement** (in `rubric.py`)

```python
CREDENTIAL_LOOKALIKE_MARKERS = ("lookalike", )

def _is_credential_lookalike_floor(f: Finding) -> bool:
    # Floor only for a *verified*-reference lookalike login ask (spec §5/S5).
    # user_provided_unverified lookalikes are handled by the §9.1 cap below,
    # never the floor.
    return (f.provenance == "web_verified"
            and f.user_safety_alert
            and f.direction == "suspicious"
            and "log in" in f.claim.lower()
            and any(m in f.claim.lower() for m in CREDENTIAL_LOOKALIKE_MARKERS))
```

In `compute_assessment`, after the payment floor block:

```python
    if any(_is_credential_lookalike_floor(f) for f in findings):
        band = _floor(band, "HIGH")
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/test_rubric.py -v -k lookalike`
Expected: PASS

### Task 5.2: Gap-B precondition — deterministic-on-user-entity can't move a named company unconfirmed

**Files:**
- Modify: `apps/api/src/app/rubric.py`
- Test: `apps/api/tests/test_rubric.py`

- [ ] **Step 1: Write the failing test**

```python
def test_high_severity_deterministic_capped_for_named_company_when_unconfirmed():
    # a homoglyph-style high deterministic finding, ownership NOT confirmed
    f = Finding(id="det_homoglyph", category="domain", direction="suspicious", severity="high",
                claim="The contact domain is a lookalike of the company's real domain.",
                provenance="deterministic", source_ids=["src_det_domain"])
    a = compute_assessment(_state([f], signals={"entity_ownership_confirmed": False}))
    assert a.band == "MODERATE"

def test_high_severity_deterministic_uncapped_when_ownership_confirmed():
    f = Finding(id="det_homoglyph", category="domain", direction="suspicious", severity="high",
                claim="lookalike ...", provenance="deterministic", source_ids=["src_det_domain"])
    a = compute_assessment(_state([f], signals={"entity_ownership_confirmed": True}))
    assert a.band in ("HIGH", "CRITICAL")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/test_rubric.py -v -k deterministic_capped`
Expected: FAIL — the high deterministic finding drives HIGH regardless of confirmation.

- [ ] **Step 3: Implement** (in `compute_assessment`, before the payment/credential floors so a genuine payment floor can still override)

```python
    # Gap B (spec §5): a deterministic signal computed on a user-supplied entity
    # (domain/email) cannot move a NAMED company's band past MODERATE until
    # disambiguation (§7) confirms the entity belongs to that company. Without
    # confirmation, a saboteur's chosen throwaway domain must not defame a real
    # employer. Only high-severity deterministic findings can breach MODERATE on
    # their own, so gate on those.
    ownership_confirmed = bool(signals.get("entity_ownership_confirmed"))
    high_det = [f for f in deterministic_suspicious if _POINTS[f.severity] >= _POINTS["high"]]
    if state.entities.company_name and not ownership_confirmed and high_det:
        band = _cap(band, "MODERATE")
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/test_rubric.py -v`
Expected: PASS. **Audit the existing rubric tests**: any that expect a homoglyph/high-deterministic finding to yield HIGH with a `company_name` set must now either set `entity_ownership_confirmed: True` in signals or drop the company name. Fix each to reflect the intended §9.1/Gap-B behavior — do not weaken the new rule to preserve a stale test.

---

## Phase 6 — Report callout + eval regressions

The report renders the safety callout, provenance-gated and defanged, and the eval dataset locks in the §9.7 behaviors as regression gates (spec §10).

### Task 6.1: Provenance-gated, defanged safety callout

**Files:**
- Modify: `apps/api/src/app/graph/nodes/report.py`
- Test: `apps/api/tests/` (add `tests/graph/nodes/test_report_callout.py`)

**Interfaces:**
- Consumes: `state.findings` with `user_safety_alert`, `state.entities.company_name`, `defang_text`.
- Produces: a `safety_callouts: list[str]` on the report output (added to `_ReportLLM`-adjacent post-processing, computed deterministically — not written by the LLM).

- [ ] **Step 1: Write the failing test**

```python
# tests/graph/nodes/test_report_callout.py
from app.graph.nodes.report import build_safety_callouts
from app.graph.state import ExtractedEntities, Finding

def _f(prov, claim):
    return Finding(id="x", category="communication", direction="suspicious", severity="high",
                   claim=claim, provenance=prov, user_safety_alert=True)

def test_unverified_callout_is_entity_decoupled():
    ents = ExtractedEntities(company_name="Acme")
    outs = build_safety_callouts(
        [_f("user_provided_unverified", "log in on a lookalike (https://acme-verify.io/login)")], ents)
    assert outs and "Acme" not in outs[0]              # never names the company when unverified
    assert "hxxps://" in outs[0] or "[.]" in outs[0]   # defanged

def test_web_verified_callout_may_name_company():
    ents = ExtractedEntities(company_name="Acme")
    outs = build_safety_callouts(
        [_f("web_verified", "log in on a lookalike (https://acme-verify.io/login)")], ents)
    assert outs

def test_no_alert_no_callout():
    ents = ExtractedEntities(company_name="Acme")
    f = Finding(id="x", category="communication", direction="suspicious", severity="low",
                claim="c", provenance="user_provided_unverified", user_safety_alert=False)
    assert build_safety_callouts([f], ents) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/nodes/test_report_callout.py -v`
Expected: FAIL — `build_safety_callouts` undefined.

- [ ] **Step 3: Implement** (in `report.py`)

```python
def build_safety_callouts(findings, entities) -> list[str]:
    """Deterministic §9.7 safety callouts. Unverified asks are entity-decoupled
    (never name the company); verified asks may carry company context. All links
    are defanged (spec §9.5)."""
    outs: list[str] = []
    for f in findings:
        if not getattr(f, "user_safety_alert", False):
            continue
        text = defang_text(f.claim)
        if f.provenance == "user_provided_unverified":
            # strip any company-name mention; frame as "a posting you submitted"
            name = (entities.company_name or "").strip()
            if name:
                text = text.replace(name, "the employer")
            outs.append("Safety warning — a posting you submitted asks you to take a risky "
                        f"action. {text} Do not do this before verifying independently.")
        else:
            outs.append(f"Safety warning — {text} Do not do this before verifying independently.")
    return outs
```

Wire `safety_callouts=build_safety_callouts(state.findings, state.entities)` into whatever the node returns onto the assessment/report payload (follow the existing return shape in `report.py`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest tests/graph/nodes/test_report_callout.py -v`
Expected: PASS

### Task 6.2: Eval regressions (spec §10)

**Files:**
- Modify: `apps/api/eval/dataset.json`, `apps/api/eval/test_eval.py`
- Test: the eval harness itself.

- [ ] **Step 1: Write the failing test/case**

Add labeled cases to `dataset.json` following its existing shape (inspect one entry first). Required cases, each with expected band/callout expectations:
- `apk_download_posting` — pasted posting with `https://x.io/app.apk` → expect a `user_safety_alert` callout, band not artificially HIGH from this alone for a named company.
- `lookalike_login_posting` — pasted, real company + lookalike login link, no verified ref → callout entity-decoupled, band ≤ MODERATE.
- `ats_signup_posting` — `https://acme.greenhouse.io/apply` → **no** callout, no suspicious finding (FP guard).
- `app_store_link_posting` — `https://play.google.com/...` → no callout.
- `open_redirect_greenhouse` — `greenhouse.io/redirect?url=https://evil.com/login` → **not** neutral (soft `unknown`, no false clearance).
- `v0_sabotage_lookalike` — real company name + lookalike login link in pasted text → **assert band ≤ MODERATE and the callout string does not contain the company name**.

Add assertions in `test_eval.py` mirroring its existing per-case assertion style.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run pytest eval/test_eval.py -v -k "sabotage or lookalike or redirect"`
Expected: FAIL until Phases 1-6 wiring is complete end-to-end.

- [ ] **Step 3: Implement**

No new product code if Phases 1-5 are correct — this task is the end-to-end gate. If a case fails, fix the responsible module (not the test).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run pytest eval/ -v`
Expected: PASS. Then run the full suite: `cd apps/api && uv run pytest -q` — expect green (with the existing-test updates from Tasks 4.2 and 5.2 applied).

---

## Self-Review

**Spec coverage (§9.7 + fixes):**
- Deterministic link scan over pasted text + fetched pages → Phases 2-3. ✔
- Pure URL parsing, no network (S4) → Task 1.2 (Global Constraints enforce it). ✔
- Strict host allowlists / evasion resistance (S3) → Task 1.2 tests. ✔
- `user_safety_alert` field + provenance-gated entity-decoupled callout (S2) → Tasks 1.1, 6.1. ✔
- Provenance keys on who fetched (S1) → Task 3.1 (paste=unverified, fetched=verified) + rubric §9.1 cap. ✔
- Credential HIGH floor gated on web-verified reference (S5) → Task 5.1. ✔
- Homoglyph reference web-verified (Gap A) → Phase 4. ✔
- Deterministic-on-user-entity can't move named company unconfirmed (Gap B) → Task 5.2. ✔
- `unknown` = soft, checklist, no alert → Tasks 2.2, 6.1. ✔
- Eval cases incl. evasion + V0 sabotage (§10) → Task 6.2. ✔

**Placeholder scan:** All code steps carry real, runnable code. Phase 4 Task 4.1 Step 1 and Task 4.2 Step 1 defer to the existing test idioms rather than inventing new monkeypatch shapes — the implementer must read the neighboring test first; this is a known, called-out dependency, not a gap.

**Type consistency:** `LinkClass(kind, dangerous, host)`, `classify_link(url, *, canonical_domain, canonical_verified)`, `scan_links(text, *, provenance, canonical_domain, canonical_verified, id_prefix)`, `run_deterministic_checks(entities, *, today, verified_canonical_domain)`, `build_safety_callouts(findings, entities)` — names are used identically across all tasks. `homoglyph_hit(candidate, real)` matches the existing signature (`checks/homoglyph.py:48`). `registrable_suffix_match`/`matches_any` match `checks/domain_match.py`.

**Known risks flagged for the executor:**
1. Phase 5 changes shared rubric behavior — existing rubric/checks-node tests that assumed a homoglyph HIGH with a named company will need updating (called out in Tasks 4.2 and 5.2). Treat those as intended behavior changes, not regressions.
2. The V0 deterministic ask-type inference (`_ask_type`) is heuristic (URL markers). This is the acknowledged V0 limitation the spec assigns to V1's LLM `conversation_analysis`; do not over-invest in it here.
