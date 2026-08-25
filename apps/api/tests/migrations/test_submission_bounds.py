from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()
SQL = (MIGRATIONS / "20260826121000_submission_bounds.sql").read_text().lower()


def test_adds_submission_size_constraint():
    assert "investigations_submission_size_chk" in SQL
    assert "add constraint" in SQL
    # total blob cap and per-field caps
    assert "char_length(submission::text)" in SQL
    assert "submission->>'company_name'" in SQL
    assert "submission->>'recruiter_email'" in SQL
    assert "submission->>'job_url'" in SQL


def test_constraint_is_idempotent():
    # add constraint has no `if not exists`; guard with a drop-then-add or a
    # do-block existence check so re-running the migration is safe.
    assert "drop constraint if exists investigations_submission_size_chk" in SQL


def test_verify_rls_has_submission_bounds_case():
    assert "case 20" in VERIFY
    assert "oversized company_name was accepted" in VERIFY
