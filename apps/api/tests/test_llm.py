import pytest
from pydantic import BaseModel
from app import llm

class Out(BaseModel):
    value: str

class FakeStructured:
    """Mimics model.with_structured_output(..., include_raw=True)."""
    def __init__(self, results): self._results = list(results)
    async def ainvoke(self, messages):
        return self._results.pop(0)

def _raw(tokens=100):
    class R:  # stand-in for an AIMessage with usage_metadata
        usage_metadata = {"input_tokens": tokens, "output_tokens": tokens}
    return R()

@pytest.mark.asyncio
async def test_structured_call_parses(monkeypatch):
    fake = FakeStructured([{"parsed": Out(value="ok"), "raw": _raw(), "parsing_error": None}])
    monkeypatch.setattr(llm, "_bind", lambda model, schema: fake)
    obj, usage = await llm.structured_call("m", Out, [("user", "hi")], node="analysis")
    assert obj.value == "ok"
    assert usage.node == "analysis" and usage.input_tokens == 100

@pytest.mark.asyncio
async def test_structured_call_retries_once_then_succeeds(monkeypatch):
    fake = FakeStructured([
        {"parsed": None, "raw": _raw(), "parsing_error": ValueError("bad json")},
        {"parsed": Out(value="recovered"), "raw": _raw(), "parsing_error": None},
    ])
    monkeypatch.setattr(llm, "_bind", lambda model, schema: fake)
    obj, _ = await llm.structured_call("m", Out, [("user", "hi")], node="analysis")
    assert obj.value == "recovered"

@pytest.mark.asyncio
async def test_structured_call_raises_after_second_failure(monkeypatch):
    fake = FakeStructured([
        {"parsed": None, "raw": _raw(), "parsing_error": ValueError("bad1")},
        {"parsed": None, "raw": _raw(), "parsing_error": ValueError("bad2")},
    ])
    monkeypatch.setattr(llm, "_bind", lambda model, schema: fake)
    with pytest.raises(llm.StructuredCallError):
        await llm.structured_call("m", Out, [("user", "hi")], node="analysis")
