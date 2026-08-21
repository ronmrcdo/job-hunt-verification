"""Text assertions over the public_stats migration (same convention as
test_weekly_quota_topup.py): the migration is operator-applied, so these
tests pin the SQL contract rather than execute it."""
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"
VERIFY = (MIGRATIONS.parents[1] / "scripts" / "verify_rls.sql").read_text().lower()


def _sql(name: str) -> str:
    p = MIGRATIONS / name
    return p.read_text().lower() if p.exists() else ""


STATS = _sql("20260821140000_public_stats.sql")


def test_finished_at_column_added():
    assert "add column if not exists finished_at timestamptz" in STATS


def test_terminal_status_stamps_finished_at():
    assert "create or replace function stamp_investigation_finished()" in STATS
    assert "before update on investigations" in STATS
    # every terminal status, not just 'done' — the median must not silently
    # depend on which terminal writer got there first.
    assert "'done'" in STATS and "'failed'" in STATS and "'deadline_exceeded'" in STATS
    # write-once: a re-applied terminal update must not move the stamp.
    assert "new.finished_at is null" in STATS


def test_existing_done_rows_backfilled_from_steps():
    assert "update investigations" in STATS
    assert "max(finished_at)" in STATS
    assert "from investigation_steps" in STATS


def test_client_cannot_seed_finished_at():
    assert "create or replace function force_investigation_defaults()" in STATS
    assert "new.finished_at := null" in STATS
    # the re-assert must keep every previously nulled column (last defined in
    # 20260821000000_investigations_title.sql).
    for col in ("new.status := 'queued'", "new.check_count := null", "new.assessment := null",
                "new.findings := null", "new.sources := null", "new.cost := null",
                "new.what_to_verify := null", "new.started_at := null", "new.title := null"):
        assert col in STATS


def test_public_stats_is_stable_security_definer():
    assert "drop function if exists public_stats()" in STATS
    assert "create or replace function public_stats()" in STATS
    assert "security definer" in STATS
    assert "stable" in STATS
    assert "set search_path = public" in STATS


def test_public_stats_returns_the_three_rail_columns():
    assert "postings_checked int" in STATS
    assert "findings_with_sources_pct int" in STATS
    assert "median_seconds int" in STATS


def test_public_stats_counts_only_completed_investigations():
    assert "where status = 'done'" in STATS


def test_findings_pct_counts_findings_carrying_source_ids():
    assert "jsonb_array_elements" in STATS
    assert "source_ids" in STATS
    # a non-array findings column must not error the whole RPC
    assert "jsonb_typeof" in STATS
    # no findings at all => null, never a fabricated 0%
    assert "case when count(*) = 0 then null" in STATS


def test_median_is_percentile_cont_over_created_to_finished():
    assert "percentile_cont(0.5)" in STATS
    assert "finished_at - created_at" in STATS
    assert "finished_at is not null" in STATS


def test_public_stats_executable_by_anon():
    assert "revoke all on function public_stats() from public" in STATS
    assert "grant execute on function public_stats() to anon, authenticated" in STATS


def test_verify_rls_has_public_stats_case():
    assert "case 17" in VERIFY
    assert "public_stats" in VERIFY
