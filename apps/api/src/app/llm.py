from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.config import settings
from app.cost_tracker import NodeUsage, price_usage


class StructuredCallError(RuntimeError):
    pass


def cheap_model() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.cheap_model,
        api_key=settings.openai_api_key,
        reasoning_effort=settings.cheap_reasoning_effort,
    )


def strong_model() -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.strong_model,
        api_key=settings.openai_api_key,
        reasoning_effort=settings.strong_reasoning_effort,
    )


def _bind(model: ChatOpenAI, schema):
    # Static prefix cache-friendliness lives in the caller's message ordering.
    return model.with_structured_output(
        schema, method="json_schema", strict=True, include_raw=True
    )


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
