from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
RLS = (MIGRATIONS / "20260819081000_worker_table_rls.sql").read_text().lower() \
    if (MIGRATIONS / "20260819081000_worker_table_rls.sql").exists() else ""

WORKER_TABLES = ["cache", "checkpoints", "checkpoint_blobs",
                 "checkpoint_writes", "checkpoint_migrations"]


def test_migration_creates_cache_table_matching_cache_py():
    assert "create table if not exists cache" in RLS
    # columns app/cache.py reads: key, value, expires_at
    for col in ("key", "value", "expires_at"):
        assert col in RLS


def test_rls_enabled_on_every_worker_only_table():
    for t in WORKER_TABLES:
        assert f"alter table {t} enable row level security" in RLS, t


def test_no_client_policies_on_worker_tables():
    # Deny-all == RLS on with zero policies. Service role still bypasses.
    assert "create policy" not in RLS


VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def test_verify_rls_asserts_worker_table_non_exposure():
    # A new case must reference cache + checkpoints under the authenticated role.
    assert "cache" in VERIFY
    assert "checkpoints" in VERIFY
    assert "case 8" in VERIFY  # the new block


STARTED = (MIGRATIONS / "20260819082000_investigations_started_at.sql").read_text().lower() \
    if (MIGRATIONS / "20260819082000_investigations_started_at.sql").exists() else ""


def test_started_at_column_added_and_nulled_in_defaults_trigger():
    assert "add column if not exists started_at timestamptz" in STARTED
    assert "new.started_at := null" in STARTED  # client can't seed it
