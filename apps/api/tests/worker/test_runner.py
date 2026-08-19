import uuid
from contextlib import asynccontextmanager
from langgraph.checkpoint.memory import InMemorySaver
from app.graph.state import RawSubmission, InvestigationState
from app.worker import runner


class FakeCheckpointer(InMemorySaver):
    """Stands in for AsyncPostgresSaver in tests. Must be a real
    BaseCheckpointSaver — build_graph()/StateGraph.compile() validates the
    checkpointer's type — but is never actually invoked, since
    _stream_events/_final_state are monkeypatched below. Only adds the
    async `setup()` AsyncPostgresSaver has (InMemorySaver has none)."""
    async def setup(self): pass


@asynccontextmanager
async def _fake_checkpointer_cm():
    yield FakeCheckpointer()


class FakeSink:
    def __init__(self): self.calls = []
    async def seed(self, inv, steps): self.calls.append(("seed", [s.step_key for s in steps]))
    async def running(self, inv, key, at): self.calls.append(("running", key))
    async def done(self, inv, key, at): self.calls.append(("done", key))
    async def backfill(self, inv): self.calls.append(("backfill",))


async def _events():
    # Minimal astream_events shape: registered + unregistered nodes interleaved.
    yield {"event": "on_chain_start", "name": "intake"}
    yield {"event": "on_chain_end",   "name": "intake"}
    yield {"event": "on_chain_start", "name": "evidence"}   # unregistered -> ignored
    yield {"event": "on_chain_end",   "name": "evidence"}
    yield {"event": "on_chain_start", "name": "report"}
    yield {"event": "on_chain_end",   "name": "report"}


async def test_emits_seed_then_running_done_only_for_registered_nodes(monkeypatch):
    sink = FakeSink()
    monkeypatch.setattr(runner, "_checkpointer_cm", lambda: _fake_checkpointer_cm())
    monkeypatch.setattr(runner, "_stream_events",
                        lambda graph, state, config: _events())
    monkeypatch.setattr(runner, "_final_state",
                        lambda graph, config: InvestigationState(submission=RawSubmission(job_text="x")))
    state, status = await runner.run_and_emit(uuid.uuid4(), RawSubmission(job_text="x"), sink)
    assert status == "done"
    assert sink.calls[0][0] == "seed"
    assert ("running", "intake") in sink.calls and ("done", "intake") in sink.calls
    assert ("running", "report") in sink.calls
    assert all("evidence" not in c for c in sink.calls)   # unregistered node emits nothing
