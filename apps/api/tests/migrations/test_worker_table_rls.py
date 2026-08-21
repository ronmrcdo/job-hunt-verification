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


TITLE = (MIGRATIONS / "20260821000000_investigations_title.sql").read_text().lower() \
    if (MIGRATIONS / "20260821000000_investigations_title.sql").exists() else ""


def test_title_column_added_and_nulled_in_defaults_trigger():
    assert "add column if not exists title text" in TITLE
    assert "new.title := null" in TITLE  # worker-set only; client can't seed it


ENTITIES = (MIGRATIONS / "20260822000000_investigations_entities.sql").read_text().lower() \
    if (MIGRATIONS / "20260822000000_investigations_entities.sql").exists() else ""


def test_entities_column_added_and_nulled_in_defaults_trigger():
    assert "add column if not exists entities jsonb" in ENTITIES
    assert "new.entities := null" in ENTITIES  # worker-set only; client can't seed it


def test_entities_migration_reasserts_full_defaults_trigger_body():
    # create-or-replace REPLACES the whole body: every column the earlier
    # migrations null must be repeated here or its guard is silently lost.
    for line in ("new.status := 'queued'", "new.check_count := null",
                 "new.assessment := null", "new.findings := null",
                 "new.sources := null", "new.cost := null",
                 "new.what_to_verify := null", "new.started_at := null",
                 "new.title := null", "new.finished_at := null"):
        assert line in ENTITIES
