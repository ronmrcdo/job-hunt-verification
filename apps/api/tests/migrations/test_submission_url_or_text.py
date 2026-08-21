from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
SQL = (MIGRATIONS / "20260822010000_submission_url_or_text.sql").read_text().lower() \
    if (MIGRATIONS / "20260822010000_submission_url_or_text.sql").exists() else ""


def test_drops_the_old_job_text_only_constraint():
    assert "drop constraint if exists investigations_job_text_chk" in SQL


def test_adds_text_or_url_constraint():
    assert "investigations_submission_content_chk" in SQL
    # text branch keeps the 1..40000 cap …
    assert "char_length(submission->>'job_text') between 1 and 40000" in SQL
    # … or a non-empty url satisfies it instead.
    assert "submission ? 'job_url'" in SQL
    assert "char_length(submission->>'job_url') > 0" in SQL
