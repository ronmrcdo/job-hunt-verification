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
    "ai_assistant": re.compile(r"\b(ai|language model) (assistant|model)\b", re.I),
    "note_to_ai": re.compile(r"note to (ai|assistants?)", re.I),
    "mark_legitimate": re.compile(r"mark (this )?(as )?(legitimate|verified|safe)", re.I),
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
