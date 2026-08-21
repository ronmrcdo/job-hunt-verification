from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def _sql(name: str) -> str:
    p = MIGRATIONS / name
    return p.read_text().lower() if p.exists() else ""


QUOTA = _sql("20260821120000_check_quota.sql")


def test_quota_index_created():
    assert "investigations_user_created_idx" in QUOTA
    assert "on investigations (user_id, created_at)" in QUOTA


def test_quota_trigger_reads_operator_settings_with_defaults():
    assert "app.settings.check_quota_limit" in QUOTA
    assert "app.settings.check_quota_window_days" in QUOTA
    assert ", 3)" in QUOTA          # limit fallback
    assert ", 14)" in QUOTA         # window fallback


def test_quota_trigger_guards_null_uid():
    assert "auth.uid() is null" in QUOTA


def test_quota_trigger_raises_pt429_with_message_and_hint():
    assert "pt429" in QUOTA
    assert "check_quota_exceeded" in QUOTA
    assert "hint" in QUOTA


def test_quota_trigger_logs_denials():
    assert "raise log" in QUOTA


def test_quota_trigger_is_before_insert_on_investigations():
    assert "trg_enforce_check_quota before insert on investigations" in QUOTA


def test_verify_rls_has_quota_case():
    assert "case 9" in VERIFY


RPC = _sql("20260821121000_quota_status_rpc.sql")


def test_quota_status_function_shape():
    assert "create or replace function quota_status()" in RPC
    assert "returns table(used int" in RPC
    assert "resets_at timestamptz" in RPC


def test_quota_status_is_security_definer():
    assert "security definer" in RPC


def test_quota_status_granted_to_authenticated_only():
    assert "revoke all on function quota_status() from public" in RPC
    assert "grant execute on function quota_status() to authenticated" in RPC
