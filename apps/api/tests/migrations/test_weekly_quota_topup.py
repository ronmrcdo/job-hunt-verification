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


STATE = _sql("20260821130100_user_check_quota.sql")


def test_user_check_quota_table():
    assert "create table if not exists user_check_quota" in STATE
    assert "user_id uuid primary key references auth.users(id) on delete cascade" in STATE
    assert "top_up_balance int not null default 0 check (top_up_balance >= 0)" in STATE


def test_user_check_quota_rls_select_own_no_client_write():
    assert "alter table user_check_quota enable row level security" in STATE
    assert "for select using (user_id = auth.uid())" in STATE
    assert "revoke all on user_check_quota from anon, authenticated" in STATE
    assert "grant select on user_check_quota to authenticated" in STATE


def test_quota_source_column_added():
    assert "add column if not exists quota_source text" in STATE
    assert "check (quota_source in ('weekly', 'top_up'))" in STATE


def test_provision_trigger_seeds_default_balance():
    assert "create or replace function provision_user_quota()" in STATE
    assert "security definer" in STATE
    assert "app_setting('default_top_up_balance', '0')" in STATE
    assert "trigger trg_provision_user_quota after insert on auth.users" in STATE


def test_existing_users_backfilled():
    assert "insert into user_check_quota (user_id, top_up_balance)" in STATE
    assert "from auth.users" in STATE


def test_verify_rls_has_provisioning_case():
    assert "case 13" in VERIFY


ENFORCE = _sql("20260821130200_enforce_check_quota_weekly_topup.sql")


def test_enforce_is_security_definer():
    assert "create or replace function enforce_check_quota()" in ENFORCE
    assert "security definer" in ENFORCE
    assert "set search_path = public" in ENFORCE


def test_enforce_reads_settings_from_table():
    assert "app_setting('check_quota_limit', '3')" in ENFORCE
    assert "app_setting('check_quota_window_days', '7')" in ENFORCE


def test_enforce_counts_only_weekly_source_in_window():
    assert "quota_source = 'weekly'" in ENFORCE
    assert "created_at > now() - (win || ' days')::interval" in ENFORCE


def test_enforce_charges_weekly_then_topup_with_row_lock():
    assert "new.quota_source := 'weekly'" in ENFORCE
    assert "from user_check_quota" in ENFORCE
    assert "for update" in ENFORCE
    assert "top_up_balance = top_up_balance - 1" in ENFORCE
    assert "new.quota_source := 'top_up'" in ENFORCE


def test_enforce_denies_with_pt429_and_hint_and_logs():
    assert "auth.uid() is null" in ENFORCE
    assert "raise log" in ENFORCE
    assert "pt429" in ENFORCE
    assert "check_quota_exceeded" in ENFORCE
    assert "hint" in ENFORCE


def test_verify_rls_has_topup_case():
    assert "case 14" in VERIFY


STATUS = _sql("20260821130300_quota_status_weekly_topup.sql")


def test_quota_status_new_four_column_shape():
    assert "create or replace function quota_status()" in STATUS
    assert "returns table(weekly_used int, weekly_limit int, resets_at timestamptz, top_up_balance int)" in STATUS


def test_quota_status_security_definer_and_grant():
    assert "security definer" in STATUS
    assert "revoke all on function quota_status() from public" in STATUS
    assert "grant execute on function quota_status() to authenticated" in STATUS


def test_quota_status_counts_weekly_and_joins_balance():
    assert "quota_source = 'weekly'" in STATUS
    assert "left join user_check_quota" in STATUS


def test_verify_rls_has_quota_status_case():
    assert "case 15" in VERIFY
