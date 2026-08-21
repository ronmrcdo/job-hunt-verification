from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def _sql(name: str) -> str:
    p = MIGRATIONS / name
    return p.read_text().lower() if p.exists() else ""


APP = _sql("20260821130000_app_settings.sql")


def test_app_settings_table_created():
    assert "create table if not exists app_settings" in APP
    assert "key text primary key" in APP
    assert "value text not null" in APP


def test_app_settings_seed_rows():
    assert "'check_quota_limit', '3'" in APP
    assert "'check_quota_window_days', '7'" in APP
    assert "'default_top_up_balance', '0'" in APP
    assert "on conflict (key) do nothing" in APP


def test_app_setting_helper_is_security_definer_with_default():
    assert "create or replace function app_setting(k text, d text)" in APP
    assert "security definer" in APP
    assert "set search_path = public" in APP
    assert "coalesce((select value from app_settings where key = k), d)" in APP


def test_app_settings_not_client_writable():
    assert "alter table app_settings enable row level security" in APP
    assert "revoke all on app_settings from anon, authenticated" in APP
