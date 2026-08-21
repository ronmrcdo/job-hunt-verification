from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.config import settings
from app.cost_tracker import NodeUsage, price_usage


class StructuredCallError(RuntimeError):
    pass


# or None so an unset base_url falls back to the real api.openai.com default
# instead of an empty string that the client would treat as the host.
_BASE_URL = settings.openai_base_url or None


def _build_model(model_name: str, reasoning_effort: str) -> ChatOpenAI:
    kwargs = dict(
        model=model_name,
        api_key=settings.openai_api_key,
        base_url=_BASE_URL,
        timeout=settings.llm_timeout_s,
        max_retries=0,
    )
    # Only send reasoning_effort when configured: OpenAI takes low|medium|high,
    # but DeepSeek v4 rejects low/medium (and some hosts reject the param
    # outright), so a blank effort omits it entirely rather than erroring a
    # non-retrying call.
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort
    return ChatOpenAI(**kwargs)


def cheap_model() -> ChatOpenAI:
    return _build_model(settings.cheap_model, settings.cheap_reasoning_effort)


def strong_model() -> ChatOpenAI:
    return _build_model(settings.strong_model, settings.strong_reasoning_effort)


def _bind(model: ChatOpenAI, schema):
    # Static prefix cache-friendliness lives in the caller's message ordering.
    # method/strict are configurable so a DeepSeek deployment can drop from the
    # OpenAI-native strict json_schema to function_calling without strict tool
    # schemas (which DeepSeek doesn't support); the parse-retry in
    # structured_call() covers the weaker coercion guarantee.
    kwargs = {"method": settings.structured_output_method, "include_raw": True}
    if settings.structured_output_strict:
        kwargs["strict"] = True
    if settings.structured_output_method == "function_calling":
        # function_calling makes LangChain force tool_choice to the tool name.
        # A thinking model (e.g. DeepSeek with reasoning_effort=high) rejects a
        # forced tool_choice: 400 "Thinking mode does not support this
        # tool_choice". "auto" is the only choice reasoning models accept; with
        # a single bound tool the parse-retry in structured_call() covers the
        # rare miss. (json_schema/json_mode coerce via response_format and never
        # set tool_choice, so this only applies here.)
        kwargs["tool_choice"] = "auto"
    return model.with_structured_output(schema, **kwargs)


def _model_id(model) -> str:
    return getattr(model, "model_name", getattr(model, "model", "unknown"))


async def structured_call(
    model, schema, messages, *, node: str
) -> tuple[BaseModel, NodeUsage]:
    runnable = _bind(model, schema)
    result = await runnable.ainvoke(messages)
    if result["parsing_error"] is not None:
        retry_messages = list(messages) + [
            (
                "user",
                f"Your previous output failed to parse: {result['parsing_error']}. "
                f"Return ONLY valid JSON matching the schema.",
            )
        ]
        result = await runnable.ainvoke(retry_messages)
        if result["parsing_error"] is not None:
            raise StructuredCallError(
                f"{node}: parse failed twice: {result['parsing_error']}"
            )
    usage_meta = getattr(result["raw"], "usage_metadata", None) or {}
    usage = price_usage(node, _model_id(model), usage_meta)
    return result["parsed"], usage
