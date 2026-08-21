import pytest
from pydantic import BaseModel
from app import llm

class Out(BaseModel):
    value: str


class _RecordingModel:
    """Captures the kwargs `_bind` passes to with_structured_output."""
    def __init__(self): self.calls = {}
    def with_structured_output(self, schema, **kwargs):
        self.calls = {"schema": schema, **kwargs}
        return "bound"


def test_bind_defaults_to_strict_json_schema(monkeypatch):
    # OpenAI path: strict json_schema is the guarantee we lean on.
    monkeypatch.setattr(llm.settings, "structured_output_method", "json_schema")
    monkeypatch.setattr(llm.settings, "structured_output_strict", True)
    m = _RecordingModel()
    assert llm._bind(m, Out) == "bound"
    assert m.calls["method"] == "json_schema"
    assert m.calls["strict"] is True
    assert m.calls["include_raw"] is True


def test_bind_honors_function_calling_without_strict(monkeypatch):
    # DeepSeek path: json_schema is rejected, so drop to function_calling and
    # do NOT send strict (DeepSeek doesn't support strict tool schemas).
    monkeypatch.setattr(llm.settings, "structured_output_method", "function_calling")
    monkeypatch.setattr(llm.settings, "structured_output_strict", False)
    m = _RecordingModel()
    llm._bind(m, Out)
    assert m.calls["method"] == "function_calling"
    assert "strict" not in m.calls
    assert m.calls["include_raw"] is True


def test_bind_function_calling_uses_auto_tool_choice(monkeypatch):
    # function_calling makes LangChain force tool_choice to the tool name, which
    # a thinking model (DeepSeek reasoning_effort=high) rejects with a 400:
    # "Thinking mode does not support this tool_choice". Override to "auto".
    monkeypatch.setattr(llm.settings, "structured_output_method", "function_calling")
    monkeypatch.setattr(llm.settings, "structured_output_strict", False)
    m = _RecordingModel()
    llm._bind(m, Out)
    assert m.calls["tool_choice"] == "auto"


def test_bind_json_schema_omits_tool_choice(monkeypatch):
    # json_schema coerces via response_format, not a tool call, so no tool_choice.
    monkeypatch.setattr(llm.settings, "structured_output_method", "json_schema")
    monkeypatch.setattr(llm.settings, "structured_output_strict", True)
    m = _RecordingModel()
    llm._bind(m, Out)
    assert "tool_choice" not in m.calls


def test_model_omits_reasoning_effort_when_blank(monkeypatch):
    # DeepSeek v4 rejects low/medium and some hosts reject the param entirely;
    # a blank effort means "don't send reasoning_effort at all".
    monkeypatch.setattr(llm.settings, "cheap_reasoning_effort", "")
    monkeypatch.setattr(llm.settings, "strong_reasoning_effort", "high")
    assert llm.cheap_model().reasoning_effort is None
    assert llm.strong_model().reasoning_effort == "high"

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
