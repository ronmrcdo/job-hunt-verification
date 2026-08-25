"""Fence untrusted, attacker-influenced content so it cannot forge the
delimiters that separate it from trusted prompt framing (security review H2,
spec §9.2).

Every prompt-building node wraps fetched pages / pasted postings / derived
findings in `<<<LABEL>>> … <<<END>>>` markers and tells the model never to
follow instructions inside them. That only holds if the content cannot emit
its own `<<<END>>>` and reopen a forged trusted section — so strip the fence
tokens from the untrusted text before wrapping it.
"""
import re

# A matched fence pair (e.g. "<<<END>>>", "<<<EVIDENCE>>>") is stripped whole,
# so the label text inside it can't survive as readable content either. Any
# leftover unmatched "<<<" or ">>>" is stripped too, so a payload can't rely
# on a stray half-token to help forge a fence.
_PAIR = re.compile(r"<<<[^<>]*>>>")
_STRAY = re.compile(r"<<<|>>>")


def neutralize(text: str | None) -> str:
    """Remove every `<<<`/`>>>` fence token from untrusted content, iterating to
    a fixpoint so a deletion can never re-form a fence at the junction it
    creates (e.g. "<<" + ">>>" + "<" must not collapse to "<<<"). The string
    strictly shrinks each pass, so this terminates; at the fixpoint no `<<<` or
    `>>>` remains."""
    text = text or ""
    while True:
        stripped = _STRAY.sub("", _PAIR.sub("", text))
        if stripped == text:
            return stripped
        text = stripped


def wrap_untrusted(label: str, text: str | None) -> str:
    """Fence `text` as `<<<label>>> … <<<END>>>`, neutralizing it first so the
    payload cannot break out of the fence."""
    return f"<<<{label}>>>\n{neutralize(text)}\n<<<END>>>"
