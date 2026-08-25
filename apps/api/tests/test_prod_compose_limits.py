from pathlib import Path

COMPOSE = (Path(__file__).resolve().parents[3] / "docker-compose.prod.yml").read_text()


def test_api_worker_has_resource_limits():
    assert "resources:" in COMPOSE
    assert "limits:" in COMPOSE
    assert "memory:" in COMPOSE


def test_web_carries_allowed_hosts_env():
    # Task 4 (L1) reads APP_ALLOWED_HOSTS at runtime; prod must supply it.
    assert "APP_ALLOWED_HOSTS" in COMPOSE
