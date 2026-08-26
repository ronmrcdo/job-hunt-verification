from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
SQL = (MIGRATIONS / "20260826010100_eval_candidate.sql").read_text().lower()
ADMIN_RO = (MIGRATIONS / "20260826130000_admin_ro_role.sql").read_text().lower()
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def test_creates_eval_candidate_table():
    assert "create table if not exists eval_candidate" in SQL
    for col in ("investigation_id", "submission_snapshot", "expected_max_band",
                "expected_band", "tags", "status", "promoted_by",
                "created_at", "exported_at"):
        assert col in SQL, col


def test_status_and_band_are_checked_enums():
    assert "status text not null default 'promoted' check (status in ('promoted','exported'))" in SQL
    assert "expected_max_band text not null check (expected_max_band in ('low','moderate','high','critical'))" in SQL


def test_deny_all_rls_no_policies():
    # Internal table like cache/checkpoints: RLS on, zero policies.
    assert "enable row level security" in SQL
    assert "create policy" not in SQL


def test_admin_ro_grant_lives_in_later_migration_not_here():
    # This migration (010100) predates the admin_ro role (130000); the guarded
    # INSERT grant is in the role migration, gated on the table existing.
    assert "to admin_ro" not in SQL
    assert "grant insert on public.eval_candidate to admin_ro" in ADMIN_RO


def test_verify_rls_has_eval_candidate_deny_all_case():
    assert "case 22" in VERIFY
    assert "eval_candidate" in VERIFY
