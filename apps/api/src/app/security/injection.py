"""Injection scan: deterministic detection of instruction-like patterns aimed
at AI verifiers, embedded in fetched/pasted content (spec §9.2).

Legitimate employers don't embed instructions to AI verifiers. A hit is
converted into a HIGH-severity suspicious finding, turning the attack
surface into a signal.
"""
import re
from app.graph.state import InvestigationState, Finding

_PATTERNS = {
    "ignore_previous": re.compile(r"ignore (all |the )?previous", re.I),
    # Requires instructional/address framing around the AI reference, so
    # ordinary job titles like "AI Assistant Engineer" don't match — only
    # imperative phrasing aimed at an AI verifier does.
    "ai_assistant": re.compile(
        r"(you are (an?|the) (ai|language model) (assistant|model)s?)"
        r"|(as (an?|the) (ai|language model) (assistant|model)s?)"
        r"|(dear (ai|language model) (assistant|model)s?)"
        r"|(attention (ai|language model) (assistant|model)s?)"
        r"|((ai|language model) (assistant|model)s?\s*:)",
        re.I,
    ),
    "note_to_ai": re.compile(r"note to (ai|assistants?)", re.I),
    "mark_legitimate": re.compile(r"\bmark (this )?(as )?(legitimate|verified|safe)", re.I),
    "disregard": re.compile(r"disregard (risk|the above|prior)", re.I),
}


def scan_for_injection(text: str) -> list[str]:
    return [label for label, pat in _PATTERNS.items() if pat.search(text or "")]


def injection_findings(state: InvestigationState) -> list[Finding]:
    findings = []
    for i, s in enumerate(state.sources):
        if scan_for_injection((s.raw_excerpt or "") + " " + (s.content_summary or "")):
            findings.append(Finding(
                id=f"inj_{i+1}", category="job", direction="suspicious", severity="high",
                claim="The posting/source embeds instructions aimed at an AI verifier — "
                      "a pattern legitimate employers do not use.",
                source_ids=[s.id], provenance="deterministic"))
    return findings
