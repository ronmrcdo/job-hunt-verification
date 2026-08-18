"""Conversation-analysis graph node.

BUILT BUT DORMANT IN V0 (spec §2, §14). No V0 UI populates
`conversation_text`, so this node returns an empty state update — a no-op.
V1 replaces the body with a cheap-LLM scam-pattern tagger over the
recruiter conversation. Do not delete this node: its presence in the
compiled graph keeps the graph shape stable across the V0 -> V1 flip.
"""
from app.graph.state import InvestigationState


async def conversation_analysis(state: InvestigationState) -> dict:
    if not state.submission.conversation_text:
        return {}
    raise NotImplementedError("conversation_analysis is a V1 feature")
