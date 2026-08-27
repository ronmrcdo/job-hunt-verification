from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
SQL = (MIGRATIONS / "20260827000000_admin_dashboard.sql").read_text().lower()


def test_counter_is_security_definer_stable_empty_search_path():
    assert "create or replace function public.admin_registered_user_count()" in SQL
    assert "security definer" in SQL
    assert "stable" in SQL
    assert "set search_path = ''" in SQL
    assert "from auth.users" in SQL  # fully-qualified under empty search_path


def test_execute_revoked_from_public_then_granted_to_admin_ro():
    assert "revoke execute on function public.admin_registered_user_count() from public" in SQL
    assert "grant execute on function public.admin_registered_user_count() to admin_ro" in SQL


def test_grants_admin_ro_select_on_eval_candidate_guarded():
    assert "grant select on public.eval_candidate to admin_ro" in SQL
    assert "to_regclass('public.eval_candidate')" in SQL  # safe to apply standalone


def test_does_not_grant_select_on_auth_users():
    # Positive least-privilege assertion: only the aggregate integer leaves auth.
    assert "select on auth.users" not in SQL
