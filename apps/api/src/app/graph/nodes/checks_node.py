"""Deterministic-checks graph node.

Wraps `run_deterministic_checks` (Task 1.6) as a LangGraph node and
promotes its signals into citable evidence: synthetic `Source`s with
fixed canonical IDs (`src_det_domain`, `src_det_email`) and `Finding`s
carrying `provenance="deterministic"` that cite them. These IDs are
preserved as-is downstream (evidence assembly) and exempted from the
citation token-check, so they must stay exactly as named here.
"""
from datetime import date, datetime, timezone
from app.graph.state import InvestigationState, Source, Finding
from app.checks.deterministic import run_deterministic_checks


def _src(id_: str, summary: str) -> Source:
    return Source(id=id_, url=None, kind="dns", retrieved_at=datetime.now(timezone.utc),
                  content_summary=summary, raw_excerpt=summary)


async def deterministic_checks_node(state: InvestigationState) -> dict:
    sig = await run_deterministic_checks(state.entities, today=date.today())
    sources: list[Source] = []
    findings: list[Finding] = []

    domain_src = _src("src_det_domain",
                      f"domain_age_days={sig['domain_age_days']}, mx_valid={sig['mx_valid']}, "
                      f"homoglyph_hit={sig['homoglyph_hit']}")
    email_src = _src("src_det_email",
                     f"email_domain_matches={sig['email_domain_matches']}, "
                     f"recruiter_is_ats={sig['recruiter_is_ats']}")
    sources += [domain_src, email_src]

    if sig["homoglyph_hit"]:
        findings.append(Finding(
            id="det_homoglyph", category="domain", direction="suspicious", severity="high",
            claim="The contact domain is a lookalike of the company's real domain.",
            source_ids=["src_det_domain"], provenance="deterministic"))
    if sig["recruiter_is_ats"]:
        findings.append(Finding(
            id="det_ats", category="recruiter", direction="legitimizing", severity="info",
            claim="Recruiter email uses a known applicant tracking system (ATS) domain.",
            source_ids=["src_det_email"], provenance="deterministic"))
    if sig["email_domain_matches"] is False and not sig["recruiter_is_ats"]:
        findings.append(Finding(
            id="det_email_mismatch", category="recruiter", direction="suspicious", severity="low",
            claim="Recruiter email domain does not match the company domain.",
            source_ids=["src_det_email"], provenance="deterministic"))
    if isinstance(sig["domain_age_days"], int) and sig["domain_age_days"] < 30:
        findings.append(Finding(
            id="det_new_domain", category="domain", direction="suspicious", severity="low",
            claim=f"Company domain was registered {sig['domain_age_days']} days ago (very recent).",
            source_ids=["src_det_domain"], provenance="deterministic"))

    return {"deterministic_signals": sig, "raw_sources": sources, "raw_findings": findings}
