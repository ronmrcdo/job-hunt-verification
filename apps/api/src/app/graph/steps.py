"""Graph node name -> user-facing checklist step (spec §5). Only user-meaningful
nodes appear; internal plumbing (evidence/injection/citation/banding/linter/
crosspost/conversation) emits nothing. Label + order are denormalized onto
investigation_steps rows so the frontend renders purely from data."""
from dataclasses import dataclass


@dataclass(frozen=True)
class StepDef:
    step_key: str
    label: str
    display_order: int


STEP_REGISTRY: dict[str, StepDef] = {
    "intake":   StepDef("intake", "Reading the posting", 1),
    "checks":   StepDef("deterministic_checks", "Running automated checks", 2),
    "research": StepDef("company_research", "Researching the company", 3),
    "analysis": StepDef("evidence_analysis", "Weighing the evidence", 4),
    "advocate": StepDef("devils_advocate", "Challenging the conclusion", 5),
    "report":   StepDef("report", "Writing the report", 6),
}
