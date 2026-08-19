-- supabase/migrations/20260819081000_worker_table_rls.sql
-- Closes two review findings on the worker-only tables:
--  (1) The `cache` table (dedupe, spec §3/§5) had no migration — it was only
--      ever created by db.init_tables() in tests, so a fresh Supabase DB +
--      the worker's cache lookup (cache.py, reached for any job_url) failed
--      with `relation "cache" does not exist`. Create it here.
--  (2) The worker-only tables sat in `public` with RLS OFF. service_role and
--      the worker's direct DATABASE_URL owner connection BYPASS RLS, so
--      enabling it does not affect the worker; it only closes the default
--      public grants that expose these rows (full InvestigationState in
--      checkpoints.checkpoint) to anon/authenticated via PostgREST.
-- OPERATOR: apply after 20260819073430_langgraph_checkpointer.sql. Not run by
-- the implementation. Verified by scripts/verify_rls.sql.

-- (1) Dedupe cache — columns mirror app/cache.py (key, value, expires_at).
create table if not exists cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);

-- (2) Deny-all RLS (RLS enabled, zero policies) on every worker-only table.
-- Zero policies defined: authenticated/anon get zero rows; the worker,
-- connecting as owner/service_role, is unaffected.
alter table cache enable row level security;
alter table checkpoints enable row level security;
alter table checkpoint_blobs enable row level security;
alter table checkpoint_writes enable row level security;
alter table checkpoint_migrations enable row level security;
