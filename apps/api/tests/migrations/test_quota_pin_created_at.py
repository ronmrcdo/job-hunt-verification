from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()
SQL = (MIGRATIONS / "20260826120000_quota_pin_created_at.sql").read_text().lower()


def test_replaces_enforce_check_quota():
    assert "create or replace function enforce_check_quota()" in SQL
    assert "security definer" in SQL
    assert "set search_path = public" in SQL


def test_pins_created_at_after_null_uid_guard():
    # The service/worker bypass must still return early…
    assert "if auth.uid() is null then" in SQL
    # …and metered client inserts must have created_at forced to now().
    assert "new.created_at := now();" in SQL
    guard = SQL.index("if auth.uid() is null then")
    pin = SQL.index("new.created_at := now();")
    assert pin > guard, "created_at pin must come AFTER the null-uid guard"


def test_verify_rls_has_created_at_spoof_case():
    assert "case 13" in VERIFY
    assert "created_at" in VERIFY
