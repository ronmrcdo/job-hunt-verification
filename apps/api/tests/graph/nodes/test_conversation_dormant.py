import pytest
from app.graph.state import InvestigationState, RawSubmission
from app.graph.nodes import conversation


@pytest.mark.asyncio
async def test_conversation_node_is_noop_without_conversation():
    state = InvestigationState(submission=RawSubmission(job_text="x", conversation_text=None))
    assert await conversation.conversation_analysis(state) == {}
