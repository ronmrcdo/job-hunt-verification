-- supabase/migrations/20260819082000_investigations_started_at.sql
-- Adds a real run-start timestamp so zombie detection measures the hard
-- deadline from when the worker actually began running (set_status 'running'),
-- not from row creation. Without it, a re-emitted stale-queued row that
-- legitimately starts running is already past the created_at window and the
-- next sweep fails it mid-run (review Important #3).
-- Worker-set only; the insert-defaults trigger nulls any client-supplied value.
-- OPERATOR: apply after 20260819080000_investigations_sources.sql.

alter table investigations add column if not exists started_at timestamptz;

-- Re-assert the full insert-defaults trigger body (last defined in
-- 20260819080000) with started_at nulled too, so a client cannot seed it.
create or replace function force_investigation_defaults()
returns trigger language plpgsql as $$
begin
  new.status := 'queued';
  new.check_count := null;
  new.assessment := null;
  new.findings := null;
  new.sources := null;
  new.cost := null;
  new.what_to_verify := null;
  new.started_at := null;
  return new;
end $$;
