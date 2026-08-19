-- supabase/migrations/20260819073430_langgraph_checkpointer.sql
-- Reproduces the schema langgraph-checkpoint-postgres (>=3.1, pinned in
-- apps/api/pyproject.toml) would create via AsyncPostgresSaver.setup().
-- OPERATOR: regenerate by capturing setup() output against a throwaway local
-- DB when bumping the checkpointer version — never hand-edit from memory.
-- Tables: checkpoint_migrations, checkpoints, checkpoint_blobs, checkpoint_writes.
--
-- Transcribed verbatim (not paraphrased) from the installed package's
-- `MIGRATIONS` list, resolved version 3.1.2:
--   apps/api/.venv/lib/python3.12/site-packages/langgraph/checkpoint/postgres/base.py
--   (lines 43-91, the `MIGRATIONS` constant applied in order by
--   AsyncPostgresSaver.setup() / PostgresSaver.setup())
-- The statements below are that list flattened into its final schema state
-- (each migration entry folded into the CREATE TABLE / ALTER / index it
-- produces), so a single migration file leaves the DB in the same end
-- state that running every MIGRATIONS entry in order would.
--
-- These tables are worker-only (accessed solely via the service-role /
-- direct DATABASE_URL connection, per spec §4 "Python verifies nothing").
-- No RLS, no client policies.

CREATE TABLE IF NOT EXISTS checkpoint_migrations (
    v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- blob is nullable per MIGRATIONS[4]:
-- "ALTER TABLE checkpoint_blobs ALTER COLUMN blob DROP not null;"
CREATE TABLE IF NOT EXISTS checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

-- task_path column added per MIGRATIONS[9]:
-- "ALTER TABLE checkpoint_writes ADD COLUMN IF NOT EXISTS task_path TEXT NOT NULL DEFAULT '';"
CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    task_path TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- Indexes per MIGRATIONS[6..8]. The package creates these CONCURRENTLY
-- (each in its own migration statement, outside a transaction) so a large
-- existing table isn't locked during setup(); a fresh Supabase CLI
-- migration runs inside a transaction block, where CONCURRENTLY is not
-- permitted, so it is dropped here. On a brand-new table this is a no-op
-- difference in locking behavior only, not in the resulting index.
CREATE INDEX IF NOT EXISTS checkpoints_thread_id_idx ON checkpoints(thread_id);
CREATE INDEX IF NOT EXISTS checkpoint_blobs_thread_id_idx ON checkpoint_blobs(thread_id);
CREATE INDEX IF NOT EXISTS checkpoint_writes_thread_id_idx ON checkpoint_writes(thread_id);

-- Mark every MIGRATIONS entry (indices 0-9 in the transcribed source) as
-- already applied, so a subsequent AsyncPostgresSaver.setup() call sees
-- `SELECT v FROM checkpoint_migrations ORDER BY v DESC LIMIT 1` = 9, skips
-- its own migration loop entirely, and is a true no-op rather than merely
-- re-running idempotent DDL.
insert into checkpoint_migrations (v)
select generate_series(0, 9)
on conflict (v) do nothing;

-- VERIFY: before applying against a fresh Supabase project, the operator
-- should diff this file against the live output of AsyncPostgresSaver's
-- setup() on a throwaway local Postgres (uv run python -c "...call
-- setup()..." against a scratch DB, then `\d` each table / pg_dump
-- --schema-only) to confirm the pinned package version has not changed
-- MIGRATIONS since this file was authored.
