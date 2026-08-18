import re
from app.graph.state import InvestigationState

_STOP = {"the", "a", "an", "is", "are", "of", "and", "or", "to", "in", "at", "on",
         "this", "that", "for", "with", "users", "report", "reports"}

def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", text.lower()) if t not in _STOP}

def citation_validator(state: InvestigationState) -> dict:
    by_id = {s.id: s for s in state.sources}
    survivors, drops = [], 0
    for f in state.findings:
        cited = [by_id[sid] for sid in f.source_ids if sid in by_id]
        if not cited:
            drops += 1
            continue
        if f.provenance != "web_verified":
            survivors.append(f)
            continue
        claim_tokens = _tokens(f.claim)
        source_tokens = set().union(*(
            _tokens((s.content_summary or "") + " " + (s.raw_excerpt or "")) for s in cited))
        if claim_tokens & source_tokens:
            survivors.append(f)
        else:
            drops += 1
    signals = {**state.deterministic_signals, "citation_drops": drops}
    return {"findings": survivors, "deterministic_signals": signals}
