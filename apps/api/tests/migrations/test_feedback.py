from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
SQL = (MIGRATIONS / "20260826010000_feedback.sql").read_text().lower()
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def test_creates_feedback_table_with_expected_columns():
    assert "create table if not exists feedback" in SQL
    for col in ("investigation_id", "user_id", "verdict", "wrong_finding_id", "note", "created_at"):
        assert col in SQL, col


def test_verdict_is_a_checked_enum():
    assert "check (verdict in ('agree','too_high','too_low'))" in SQL


def test_note_is_length_bounded():
    # M2 / spec Global Constraints: server-side length bound, not client zod.
    assert "char_length(note) <= 2000" in SQL


def test_wrong_finding_id_is_length_bounded():
    assert "char_length(wrong_finding_id) <= 200" in SQL


def test_rls_enabled_and_scoped_to_owner():
    assert "enable row level security" in SQL
    # own-row insert + select, no update/delete grant anywhere.
    assert "for insert to authenticated" in SQL
    assert "user_id = auth.uid()" in SQL
    assert "for select to authenticated" in SQL
    assert "using (user_id = auth.uid())" in SQL
    assert "for update" not in SQL
    assert "for delete" not in SQL


def test_insert_policy_requires_investigation_ownership():
    # feedback may only be filed about the caller's OWN investigation: the
    # WITH CHECK must also verify the referenced investigation belongs to them.
    assert "from investigations i" in SQL
    assert "i.user_id = auth.uid()" in SQL
    assert "i.id = investigation_id" in SQL


def test_created_at_and_user_id_are_server_forced():
    # security-review H1: never trust a client timestamp/identity.
    assert "before insert on feedback" in SQL
    assert "new.created_at := now()" in SQL
    assert "new.user_id := auth.uid()" in SQL
    assert "security definer set search_path = ''" in SQL


def test_dedupe_index_one_verdict_per_user_investigation():
    assert "unique index" in SQL
    assert "feedback (user_id, investigation_id)" in SQL


def test_migration_does_not_grant_to_admin_ro():
    # admin_ro is created in a LATER migration (20260826130000); granting here
    # would fail because the role doesn't exist yet at this timestamp. The
    # later migration's guarded block does the grant once this table exists.
    assert "to admin_ro" not in SQL


def test_verify_rls_has_feedback_isolation_case():
    assert "case 21" in VERIFY
    assert "feedback" in VERIFY


def test_verify_rls_has_feedback_ownership_case():
    assert "case 23" in VERIFY
