import os

import pytest

# Must run BEFORE any test module imports `app.worker.app`. That module builds
# the Inngest client with no explicit mode, so the SDK reads INNGEST_DEV to
# choose one (see the comment there). Unset => CLOUD mode, and
# `inngest.fast_api.serve` then raises SigningKeyMissingError at import time.
# Tests exercise the functions directly, not a real Inngest server, so pin the
# dev mode here rather than handing the suite a fake signing key.
os.environ.setdefault("INNGEST_DEV", "1")

from app.config import settings  # noqa: E402


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
