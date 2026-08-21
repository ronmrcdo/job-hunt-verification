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


BLOCK = _sql("20260821122000_disposable_email_block.sql")


def test_blocked_domains_table_and_seed():
    assert "create table if not exists blocked_email_domains" in BLOCK
    assert "domain text primary key" in BLOCK
    assert "mailinator.com" in BLOCK  # representative seed entry


def test_reject_disposable_email_raises_pt422():
    assert "create or replace function reject_disposable_email()" in BLOCK
    assert "pt422" in BLOCK
    assert "email_domain_not_allowed" in BLOCK


def test_reject_trigger_on_auth_users():
    assert "before insert on auth.users" in BLOCK


def test_verify_rls_has_disposable_case():
    assert "case 10" in VERIFY


OBS = _sql("20260821123000_abuse_observability.sql")


def test_abuse_views_created():
    assert "create or replace view abuse_daily_spend" in OBS
    assert "create or replace view abuse_signups_hourly" in OBS


def test_abuse_snapshot_function():
    assert "create or replace function abuse_snapshot()" in OBS
    assert "today_usd" in OBS
    assert "signups_24h" in OBS


def test_quota_trigger_denial_log_is_the_observability_signal():
    # The denial signal is the RAISE LOG in the Phase 1 quota trigger (a RAISE
    # LOG survives the transaction rollback the accompanying RAISE EXCEPTION
    # causes), so denials are observable in Postgres logs.
    assert "raise log" in QUOTA


def test_abuse_views_revoked_from_client_roles():
    assert "revoke all on abuse_daily_spend, abuse_signups_hourly from anon, authenticated" in OBS


def test_abuse_views_are_security_invoker():
    assert "security_invoker = true" in OBS


def test_verify_rls_has_abuse_authz_case():
    assert "case 11" in VERIFY
