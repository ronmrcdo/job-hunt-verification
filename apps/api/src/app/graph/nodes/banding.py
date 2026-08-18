from app.graph.state import InvestigationState
from app.rubric import compute_assessment


def risk_banding(state: InvestigationState) -> dict:
    return {"assessment": compute_assessment(state)}
