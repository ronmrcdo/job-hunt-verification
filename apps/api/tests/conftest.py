import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def _fake_api_keys(monkeypatch):
    """Nodes construct ChatOpenAI (and future Tavily clients) eagerly, which
    raises on empty credentials even when the call itself is monkeypatched
    away. `settings` is a module-level singleton instantiated at import time,
    so patching the env var after the fact has no effect — patch the
    attributes on the singleton directly. Production must still fail loudly
    on a missing real key, so this stays test-only (autouse + auto-reverting)
    rather than a default in Settings.
    """
    monkeypatch.setattr(settings, "openai_api_key", "sk-test", raising=False)
    monkeypatch.setattr(settings, "tavily_api_key", "tvly-test", raising=False)
