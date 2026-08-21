-- supabase/migrations/20260821000000_investigations_title.sql
-- Adds a worker-derived display title so the recent-checks list can label a
-- posting even when the user submitted only job text and no company name. The
-- worker extracts a company name (falling back to the job title) during intake;
-- before this column that value died with the graph run and the list fell back
-- to "Untitled posting" for every no-company submission. persist_result now
-- writes a defanged title here; the client reads it and keeps its own
-- "Untitled posting" fallback for the null case.
-- Worker-set only; the insert-defaults trigger nulls any client-supplied value.
-- OPERATOR: apply after 20260819082000_investigations_started_at.sql.

alter table investigations add column if not exists title text;

-- Re-assert the full insert-defaults trigger body (last defined in
-- 20260819082000) with title nulled too, so a client cannot seed it.
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
  new.title := null;
  return new;
end $$;
