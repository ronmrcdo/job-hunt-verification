import os
from app.config import Settings

def test_settings_reads_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/db")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-x")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("CHEAP_MODEL", "cheap-x")
    monkeypatch.setenv("STRONG_MODEL", "strong-x")
    s = Settings()
    assert s.database_url.startswith("postgresql://")
    assert s.cheap_model == "cheap-x"
    assert s.strong_model == "strong-x"
    # Defaults the spec fixes:
    assert s.cheap_reasoning_effort == "low"
    assert s.strong_reasoning_effort == "high"
    assert s.max_job_text_chars == 40_000
    assert s.fetch_timeout_s == 120.0
    assert s.branch_timeout_s == 180.0
    assert s.total_deadline_s == 600.0


def test_structured_output_method_defaults_to_strict_json_schema():
    # OpenAI-native default; DeepSeek swaps these via env (see .env.example).
    s = Settings()
    assert s.structured_output_method == "json_schema"
    assert s.structured_output_strict is True


def test_global_daily_ceiling_default():
    from app.config import Settings
    assert Settings().global_daily_usd_ceiling == 25.00


def test_structured_output_method_reads_env(monkeypatch):
    monkeypatch.setenv("STRUCTURED_OUTPUT_METHOD", "function_calling")
    monkeypatch.setenv("STRUCTURED_OUTPUT_STRICT", "false")
    s = Settings()
    assert s.structured_output_method == "function_calling"
    assert s.structured_output_strict is False
