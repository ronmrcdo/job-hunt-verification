"""Language linter: the deterministic defamation gate (spec §9.5).

Rejects declarative accusations against named entities in the report
summary and regenerates once via a cheap-LLM rewrite. If the regenerated
summary is still dirty, deterministically neutralizes it with a safe
attributed template — the system must never emit an accusation.
"""

from pydantic import BaseModel
from app.graph.state import InvestigationState
from app.security.defang import contains_accusation
from app.llm import cheap_model, structured_call

class _Regen(BaseModel):
    summary: str

_SAFE_TEMPLATE = ("We found signals consistent with known scam patterns in this posting. "
                  "Each is attributed to the evidence shown; treat this as a prompt to verify, "
                  "not a verdict about any named company.")
_SYSTEM = ("Rewrite this risk summary to remove any declarative accusation against a named "
           "company or person. Never say an entity 'is a scam' or 'is fraudulent'. Use "
           "'signals consistent with known scam patterns', attributed to evidence. Keep it short.")

async def language_linter(state: InvestigationState) -> dict:
    summary = state.assessment.summary
    if not contains_accusation(summary):
        return {"assessment": state.assessment}
    messages = [("system", _SYSTEM), ("user", summary)]
    regen, _ = await structured_call(cheap_model(), _Regen, messages, node="language_linter")
    clean = regen.summary if not contains_accusation(regen.summary) else _SAFE_TEMPLATE
    return {"assessment": state.assessment.model_copy(update={"summary": clean})}
