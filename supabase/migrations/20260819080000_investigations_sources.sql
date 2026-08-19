-- supabase/migrations/20260819080000_investigations_sources.sql
-- Adds the client-readable, already-shaped sources array to investigations.
-- The worker's persist_result() is the ONLY writer (spec §3 write-time shaping:
-- excerpted <=500 chars + defanged). Nulled on insert by force_investigation_defaults.
-- OPERATOR: apply after 20260819073420_investigations_v1.sql. Not run by the implementation.
--
-- NOTE: the `investigations` table is already in `supabase_realtime` (v1
-- migration), so no publication change is needed for the new column.

alter table investigations add column if not exists sources jsonb;

-- Extend the insert-defaults trigger so a client cannot seed sources either.
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
  return new;
end $$;
