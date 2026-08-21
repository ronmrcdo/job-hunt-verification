"""url_fetch (spec §11 URL submission + §9.3 SSRF): fetches a submitted job
link once, before intake, so a link-only submission has posting text to
extract from. Deterministic network node — kept out of intake_extraction (an
LLM node the eval harness stubs) so it never runs under eval; the eval set
supplies posting text directly. A failed fetch is a soft state (§7), handled
in evidence_assembly, never a crash here.
"""
from urllib.parse import urlparse

from app.config import settings
from app.graph.state import InvestigationState, RawSubmission
from app.tools.fetcher import safe_fetch


def _fetch_target(sub: RawSubmission) -> str | None:
    """The URL to fetch: the explicit job_url field if given, else job_text
    when it is a single bare http(s) URL (the form's main box is labelled
    'Job link or job text'). A URL merely mentioned inside prose is text, not
    a link submission, so a job_text with interior whitespace never matches."""
    if sub.job_url:
        return sub.job_url
    text = (sub.job_text or "").strip()
    if not text or any(c.isspace() for c in text):
        return None
    parsed = urlparse(text)
    return text if parsed.scheme in ("http", "https") and parsed.netloc else None


async def url_fetch(state: InvestigationState) -> dict:
    target = _fetch_target(state.submission)
    if target is None:
        return {}
    res = await safe_fetch(target)
    if res.ok and res.text.strip():
        return {"fetched_posting": res.text[: settings.max_fetched_posting_chars]}
    return {"fetch_failed": True}
