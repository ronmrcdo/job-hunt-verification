from app.cost_tracker import NodeUsage, price_usage, summarize, PRICES


def test_prices_known_model(monkeypatch):
    monkeypatch.setitem(PRICES, "luna", {"in": 0.20, "cached": 0.02, "out": 1.20})
    u = price_usage("analysis", "luna",
                    {"input_tokens": 1_000_000, "output_tokens": 1_000_000,
                     "input_token_details": {"cache_read": 0}})
    assert round(u.usd, 4) == round(0.20 + 1.20, 4)

def test_cached_tokens_billed_cheaper(monkeypatch):
    monkeypatch.setitem(PRICES, "luna", {"in": 0.20, "cached": 0.02, "out": 1.20})
    u = price_usage("analysis", "luna",
                    {"input_tokens": 1_000_000, "output_tokens": 0,
                     "input_token_details": {"cache_read": 1_000_000}})
    # all input was cached → priced at cached rate
    assert round(u.usd, 4) == 0.02
    assert u.cached_input_tokens == 1_000_000

def test_unknown_model_is_zero_cost():
    u = price_usage("analysis", "mystery-model-9",
                    {"input_tokens": 5000, "output_tokens": 5000})
    assert u.usd == 0.0
    assert u.model == "mystery-model-9"

def test_summarize_flags_over_budget():
    events = [NodeUsage(node="analysis", model="luna", input_tokens=0,
                        cached_input_tokens=0, output_tokens=0, usd=0.31)]
    s = summarize(events)
    assert s["total_usd"] == 0.31
    assert s["over_budget"] is True
