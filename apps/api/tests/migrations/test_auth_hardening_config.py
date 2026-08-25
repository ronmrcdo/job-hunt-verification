from pathlib import Path

CONFIG = (Path(__file__).resolve().parents[4] / "supabase" / "config.toml").read_text().lower()


def test_email_confirmation_enabled():
    # Dev-parity with the production posture: signups must confirm their email.
    assert "enable_confirmations = true" in CONFIG


def test_captcha_documented():
    # A captcha provider block must at least be present (enabled in prod).
    assert "[auth.captcha]" in CONFIG
