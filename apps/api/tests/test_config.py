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
    assert s.fetch_timeout_s == 10.0
