-- supabase/migrations/20260822000000_investigations_entities.sql
-- Adds the worker-extracted display entities so the report's detail grid can
-- show JOB / COMPANY / RECRUITER / EMAIL even when the user pasted only the
-- posting text. Before this column the intake node's extraction was collapsed
-- into the single `title` string and everything else died with the graph run,
-- so the grid rendered nothing for a submission with blank optional fields.
--
-- Shape (written by persistence.display_entities, all values defanged):
--   {"company_name": text|null, "job_title": text|null, "salary": text|null,
--    "recruiter_name": text|null, "contact_channel": text|null}
-- The email is deliberately NOT here: the report reads it from `submission`,
-- verbatim from the user, never from LLM output (spec §9.2).
-- Worker-set only; the insert-defaults trigger nulls any client-supplied value.
-- OPERATOR: apply after 20260821140000_public_stats.sql.

alter table investigations add column if not exists entities jsonb;

-- Re-assert the full insert-defaults trigger body (last defined in
-- 20260821140000_public_stats.sql) with entities nulled too, so a client
-- cannot seed report content on insert.
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
  new.finished_at := null;
  new.entities := null;
  return new;
end $$;
