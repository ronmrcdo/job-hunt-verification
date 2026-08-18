import os, json
from pydantic import BaseModel

BUDGET_ALERT_USD = 0.30

# Per-1M-token USD. Keys are substrings matched against the model id, so env
# names like "gpt-5.6-luna" resolve to the "luna" entry. Override via
# COST_PRICES_JSON (a JSON object of the same shape).
PRICES: dict[str, dict] = {
    "luna":  {"in": 0.20, "cached": 0.02, "out": 1.20},
    "terra": {"in": 2.00, "cached": 0.20, "out": 12.00},
}
if os.getenv("COST_PRICES_JSON"):
    PRICES.update(json.loads(os.environ["COST_PRICES_JSON"]))

class NodeUsage(BaseModel):
    node: str
    model: str
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    usd: float = 0.0

def _price_for(model: str) -> dict | None:
    for key, price in PRICES.items():
        if key in model:
            return price
    return None

def price_usage(node: str, model: str, usage_metadata: dict) -> NodeUsage:
    inp = usage_metadata.get("input_tokens", 0)
    out = usage_metadata.get("output_tokens", 0)
    cached = (usage_metadata.get("input_token_details") or {}).get("cache_read", 0)
    price = _price_for(model)
    if price is None:
        return NodeUsage(node=node, model=model, input_tokens=inp,
                         cached_input_tokens=cached, output_tokens=out, usd=0.0)
    uncached = max(inp - cached, 0)
    usd = (uncached * price["in"] + cached * price["cached"] + out * price["out"]) / 1_000_000
    return NodeUsage(node=node, model=model, input_tokens=inp,
                     cached_input_tokens=cached, output_tokens=out, usd=round(usd, 6))

def summarize(events: list[NodeUsage]) -> dict:
    total = round(sum(e.usd for e in events), 6)
    by_node: dict[str, float] = {}
    for e in events:
        by_node[e.node] = round(by_node.get(e.node, 0.0) + e.usd, 6)
    return {"total_usd": total, "by_node": by_node, "over_budget": total > BUDGET_ALERT_USD}
