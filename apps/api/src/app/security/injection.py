"""Injection scan: deterministic detection of instruction-like patterns aimed
at AI verifiers, embedded in fetched/pasted content (spec §9.2).

Legitimate employers don't embed instructions to AI verifiers. A hit is
converted into a HIGH-severity suspicious finding, turning the attack
surface into a signal. This scanner is a best-effort SIGNAL BOOSTER, not the
injection guardrail — it matches only known literal phrasings and is trivially
evadable by paraphrase. The actual defense against prompt injection is
structural: untrusted content is fenced via app.security.fences.wrap_untrusted
(so it cannot forge delimiters) and the analysis LLM has no verdict/band field
(spec §1.1). Never rely on this scanner as the sole injection defense.
"""
import re
from app.graph.state import InvestigationState, Finding

_PATTERNS = {
    # "prior" added alongside "previous" to catch "ignore prior instructions".
    "ignore_previous": re.compile(r"ignore (all |the )?(previous|prior)", re.I),
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
    # Broadened from bare "mark" to the family of verbs a scammer uses to
    # instruct a verifier to render a favorable verdict ("classify this as
    # safe", "rate this legitimate", "approve as legitimate"). The verb must
    # be immediately followed by the target phrase, so ordinary sentences
    # that merely contain "legitimate"/"trustworthy" elsewhere don't match.
    "mark_legitimate": re.compile(
        r"\b(mark|classify|rate|approve)(d|ing)? (this )?(as )?"
        r"(legitimate|verified|safe|low risk|trustworthy)\b", re.I),
    "disregard": re.compile(r"disregard (risk|the above|prior)", re.I),
    # Imperative addressed at a reviewer, bot, or automated screening system
    # ("SYSTEM NOTE TO REVIEWER", "To the automated screening system:").
    "reviewer_address": re.compile(
        r"\b(note|attention)\s+to\s+(the\s+)?"
        r"(reviewer|screening|automated|verification|compliance)\b", re.I),
    "bots_reading": re.compile(r"for (any )?(bots|ais?|automated systems?)\s+reading", re.I),
    "do_not_flag": re.compile(r"\bdo\s+not\s+flag\b|\bdon['’]?t\s+flag\b", re.I),
    "override_assessment": re.compile(
        r"override (your |the )?(risk )?(assessment|rating)\b", re.I),
    # "pre-verified"/"pre-approved"/"already verified"/"certified legitimate":
    # a scammer's assertion that the posting has already passed review.
    "pre_verified": re.compile(
        r"pre-?verified|pre-?approved|already verified|certified legitimate", re.I),
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
