"""Eval-harness fixture: `eval_runner` runs the compiled investigation graph
per case with LLM/network stubbed by default (deterministic, zero-cost, no
Postgres) so the harness runs in bare CI. `--live` runs the real graph
against real models/network for the manual accuracy comparison (spec §6,
§10, §331).

Stubbing design (spec §10 / task 6.4 brief):
    - The deterministic spine — `deterministic_checks_node` (homoglyph, ATS
      allowlist, email-domain match), the injection scanner, the citation
      validator, and the risk-banding rubric — always runs FOR REAL. Only
      its two network *leaves* (RDAP domain-age lookup, DNS MX lookup) are
      stubbed, at the exact module-level names `app.checks.deterministic`
      documents as its monkeypatch seam, so the deterministic node itself is
      genuinely exercised.
    - `job_crosspost_search` also runs for real; only its `tavily_search`
      network seam is stubbed (to no hits by default), same pattern as the
      existing node tests (tests/graph/test_build.py).
    - The four LLM-calling nodes the brief names — `company_research`,
      `analysis`, `devils_advocate`, `report_generation` — are replaced
      wholesale with rule-based stubs keyed on the submission text, at the
      same module-level names `tests/graph/test_build.py` already
      monkeypatches on `app.graph.build`.
    - `intake_extraction` is ALSO stubbed even though the brief's node list
      omits it: it is itself a `structured_call` (LLM) node, so leaving it
      real would mean a bare `pytest eval/test_eval.py` makes a real OpenAI
      call every run — a real network dependency the brief explicitly rules
      out for the default (non-`--live`) path. It is replaced with a small
      rule-based entity guesser (see `_stub_intake`) so the deterministic
      checks downstream (which read `state.entities`) still have realistic
      input to work with.
    - `conversation_analysis` and `language_linter` are left real: the
      former is a documented V0 no-op (spec §2/§14, no V0 input populates
      `conversation_text`), and the latter only calls the LLM when its
      deterministic `contains_accusation` gate trips, which the neutral
      stub-report summary below never does — so neither makes a live call.

No V0 dataset case's job posting text ever becomes a `Source` on its own
(intake only extracts entities; nothing else echoes the raw posting text
into evidence) — yet the injection scanner and the analysis LLM both work
over `state.sources`, and several dataset cases embed their signal (a
prompt-injection attempt, an ID/payment request, a cross-posted contact
mismatch) directly in the posting text. `_stub_research` mirrors what a
real fetched/cross-posted copy of the same posting would contribute — a
`Source` whose content is the submitted posting text — so those signals are
reachable by the deterministic injection scanner and the rule-based
analysis stub, without needing a live search hit to have found one.
"""
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import pytest

from app.checks import deterministic as deterministic_checks_module
from app.graph import build
from app.graph.nodes import crosspost as crosspost_module
from app.graph.state import ExtractedEntities, Finding, InvestigationState, Source


# ---------------------------------------------------------------------------
# Network leaves stubbed for the deterministic-checks pipeline and crosspost.
# ---------------------------------------------------------------------------

async def _fake_domain_age(domain, *, today):
    return 900  # a long-established domain by default; never triggers det_new_domain


async def _fake_has_valid_mx(domain):
    return True


async def _fake_tavily_search(query, *, max_results=5):
    return []  # no live search results in stub mode


# ---------------------------------------------------------------------------
# intake stub: rule-based entity guesser (LLM node, stubbed for CI safety —
# see module docstring for why this is stubbed even though the brief's node
# list only names research/analysis/devils_advocate/report).
# ---------------------------------------------------------------------------

_FREE_MAIL_PROVIDERS = frozenset({
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com",
    "icloud.com", "protonmail.com",
})

# A deliberately small set of well-known brands, used only to decide whether
# a homoglyph/lookalike comparison is even meaningful (spec §7: impersonating
# a well-known company is the homoglyph threat model). Guessing a "real
# domain" from an arbitrary company name for every case would manufacture
# false lookalikes for small/unknown companies whose own domain naturally
# doesn't match a naive slug of their name — exactly the false-positive trap
# the harness's FP-rate gate exists to catch.
_KNOWN_BRAND_DOMAINS = {
    "microsoft": "microsoft.com",
    "google": "google.com",
    "amazon": "amazon.com",
    "apple": "apple.com",
    "meta": "meta.com",
    "facebook": "facebook.com",
    "netflix": "netflix.com",
}


def _email_domain(email: str | None) -> str | None:
    return email.rsplit("@", 1)[1].lower() if email and "@" in email else None


def _url_domain(url: str | None) -> str | None:
    if not url:
        return None
    host = urlparse(url).hostname
    return host.lower() if host else None


def _guess_company_domain(sub) -> str | None:
    job_domain = _url_domain(sub.job_url)
    if job_domain:
        return job_domain
    email_domain = _email_domain(sub.recruiter_email)
    if email_domain and email_domain not in _FREE_MAIL_PROVIDERS:
        return email_domain
    return None


def _guess_real_domain(company_name: str | None) -> str | None:
    if not company_name:
        return None
    key = company_name.strip().lower()
    for brand, domain in _KNOWN_BRAND_DOMAINS.items():
        if brand in key:
            return domain
    return None


async def _stub_intake(state: InvestigationState) -> dict:
    sub = state.submission
    entities = ExtractedEntities(
        company_name=sub.company_name,
        company_domain=_guess_company_domain(sub),
        candidate_real_domain=_guess_real_domain(sub.company_name),
        recruiter_email=sub.recruiter_email,
        job_title=None,
        salary=None,
        job_url=sub.job_url,
        key_phrases=[],
    )
    return {"entities": entities}


# ---------------------------------------------------------------------------
# research stub: echoes the submitted posting text back as a Source, the way
# a real fetched/cross-posted copy of the same listing would (see module
# docstring). No summarization LLM call, no network.
# ---------------------------------------------------------------------------

_POSTING_SOURCE_PREFIX = "Submitted job posting text:"


async def _stub_research(state: InvestigationState) -> dict:
    text = state.submission.job_text[:2000]
    src = Source(
        id="raw_stub_posting",
        url=state.submission.job_url,
        kind="fetched_page" if state.submission.job_url else "search_result",
        retrieved_at=datetime.now(timezone.utc),
        content_summary=f"{_POSTING_SOURCE_PREFIX} {text}",
        raw_excerpt=text,
    )
    return {"raw_sources": [src]}


# ---------------------------------------------------------------------------
# analysis stub: rule-based scam-marker detector over the submission text,
# keyed by regex per the brief's guidance ("rule-based stubs keyed on the
# case text"). Each match becomes a `web_verified` Finding citing the
# stub-research posting Source, so the citation validator's token-overlap
# check passes for real (the claim quotes the matched substring verbatim).
# ---------------------------------------------------------------------------

_SCAM_MARKERS: list[tuple[str, re.Pattern]] = [
    ("personal identification (driver's license / date of birth) requested "
     "before any interview",
     re.compile(r"driver'?s licen[cs]e|date of birth", re.I)),
    ("package reshipping/forwarding duties, a common mule-scam pattern",
     re.compile(r"repackage|reship", re.I)),
    ("banking/payment details requested via email before any verification",
     re.compile(r"banking details|bank details", re.I)),
    ("a meta-instruction aimed at an automated reviewer, asking it to "
     "suppress risk flags",
     re.compile(r"system note|do not flag|approve (this )?as legitimate", re.I)),
    ("the same posting reported with a different contact number/email "
     "across boards",
     re.compile(r"different (phone number|contact|email)", re.I)),
]


def _posting_source_id(state: InvestigationState) -> str | None:
    for s in state.sources:
        if s.content_summary and s.content_summary.startswith(_POSTING_SOURCE_PREFIX):
            return s.id
    return state.sources[0].id if state.sources else None


async def _stub_analysis(state: InvestigationState) -> dict:
    src_id = _posting_source_id(state)
    if not src_id:
        return {}
    text = state.submission.job_text
    new = []
    for i, (label, pattern) in enumerate(_SCAM_MARKERS):
        m = pattern.search(text)
        if not m:
            continue
        new.append(Finding(
            id=f"stub_an_{i + 1}",
            category="job",
            direction="suspicious",
            severity="high",
            claim=f'The posting shows {label} (matched: "{m.group(0)}").',
            source_ids=[src_id],
            provenance="web_verified",
        ))
    if not new:
        return {}
    return {"findings": state.findings + new}


# ---------------------------------------------------------------------------
# devils_advocate stub: no-op (the real node only ever softens findings, so
# a no-op is a conservative, always-safe stand-in for it).
# ---------------------------------------------------------------------------

async def _stub_advocate(state: InvestigationState) -> dict:
    return {}


# ---------------------------------------------------------------------------
# report stub: writes a neutral summary that never trips the language
# linter's `contains_accusation` gate (so the linter never makes a live
# call either), without touching the band/confidence/coverage the rubric
# already decided.
# ---------------------------------------------------------------------------

async def _stub_report(state: InvestigationState) -> dict:
    band = state.assessment.band if state.assessment else "UNKNOWN"
    assessment = state.assessment.model_copy(update={
        "summary": f"[stub report] risk band {band} — rule-based stub evaluation, no live LLM call.",
    })
    return {"assessment": assessment}


def build_and_maybe_stub(monkeypatch, live: bool):
    """Real compiled graph under `--live`; otherwise the deterministic spine
    (checks/citation/banding/injection/crosspost) runs for real with only its
    network leaves stubbed, and the four LLM-calling nodes are replaced with
    rule-based stubs. See module docstring for the full rationale."""
    if live:
        return build.build_graph()

    monkeypatch.setattr(deterministic_checks_module, "domain_age_days", _fake_domain_age)
    monkeypatch.setattr(deterministic_checks_module, "has_valid_mx", _fake_has_valid_mx)
    monkeypatch.setattr(crosspost_module, "tavily_search", _fake_tavily_search)

    monkeypatch.setattr(build, "intake_extraction", _stub_intake)
    monkeypatch.setattr(build, "company_research", _stub_research)
    monkeypatch.setattr(build, "analysis", _stub_analysis)
    monkeypatch.setattr(build, "devils_advocate", _stub_advocate)
    monkeypatch.setattr(build, "report_generation", _stub_report)

    return build.build_graph()


def pytest_addoption(parser):
    parser.addoption("--live", action="store_true", default=False,
                      help="Run the eval harness against real models/network "
                           "(manual Luna/Terra comparison; requires "
                           "OPENAI_API_KEY/TAVILY_API_KEY, CHEAP_MODEL/STRONG_MODEL).")


@pytest.fixture
def eval_runner(request, monkeypatch):
    live = request.config.getoption("--live", default=False)

    async def run(submission):
        graph = build_and_maybe_stub(monkeypatch, live)
        result = await graph.ainvoke(InvestigationState(submission=submission))
        return InvestigationState.model_validate(result)

    return run
