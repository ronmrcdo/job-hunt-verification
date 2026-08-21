-- supabase/migrations/20260821140000_public_stats.sql
-- Backs the landing page's running totals ("Postings checked", "Findings with
-- sources attached", "Median time to a report"), which until now were three
-- hardcoded strings in ThisWeekRail.tsx.
--
-- Two parts:
--   1. `investigations.finished_at` — there was no completion timestamp, so
--      "time to a report" was not measurable at all. Stamped by a trigger
--      rather than by the worker because three separate writers reach a
--      terminal status (persist_result, mark_capacity_blocked, and the
--      sweeper's backfill); one trigger covers all of them and cannot be
--      forgotten by a fourth.
--   2. `public_stats()` — a security definer aggregate readable by anon. RLS
--      scopes `investigations` to its owner, so an unauthenticated visitor
--      can select none of them; the function returns three whole-table
--      numbers and nothing per-user or per-row.
--
-- The stats are all-time, not a rolling week: a real 7-day figure on a young
-- product reads worse than an honest cumulative count.
-- OPERATOR: apply after 20260821130400_grant_top_up.sql.

alter table investigations add column if not exists finished_at timestamptz;

-- ---------------------------------------------------------------------------
-- Completion stamp. Write-once (`new.finished_at is null`): a retried
-- terminal write, or the sweeper re-failing an already-failed row, must not
-- move a stamp that has already been set — otherwise the median silently
-- measures the last retry instead of the run.
-- ---------------------------------------------------------------------------
create or replace function stamp_investigation_finished()
returns trigger language plpgsql as $$
begin
  if new.status in ('done', 'failed', 'deadline_exceeded') and new.finished_at is null then
    new.finished_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_finished on investigations;
create trigger trg_stamp_finished before update on investigations
  for each row execute function stamp_investigation_finished();

-- Backfill rows that completed before this column existed, from the last step
-- the worker finished. Rows whose steps carry no finished_at stay null and are
-- simply excluded from the median (which requires a non-null stamp) rather
-- than being given a fabricated one.
update investigations i
   set finished_at = s.last_finished
  from (select investigation_id, max(finished_at) as last_finished
          from investigation_steps
         group by investigation_id) s
 where s.investigation_id = i.id
   and i.status = 'done'
   and i.finished_at is null
   and s.last_finished is not null;

-- Re-assert the full insert-defaults trigger body (last defined in
-- 20260821000000_investigations_title.sql) with finished_at nulled too, so a
-- client cannot seed a completion stamp on insert.
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
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- public_stats(): the three landing-rail numbers.
--
-- Each is null-when-empty rather than zero-when-empty, except the count: the
-- rail renders null as an em dash, and "0%" or "0s" on a fresh database would
-- read as a real (and terrible) measurement. `drop` first because a later
-- change to the OUT parameter row type cannot go through `create or replace`
-- (the lesson of 20260821130300_quota_status_weekly_topup.sql).
-- ---------------------------------------------------------------------------
drop function if exists public_stats();

create or replace function public_stats()
returns table(postings_checked int, findings_with_sources_pct int, median_seconds int)
language sql security definer stable
set search_path = public
as $$
  select
    (select count(*)::int
       from investigations
      where status = 'done'),

    -- Share of findings that carry at least one source id, over every
    -- completed investigation. The jsonb_typeof guard lives inside the
    -- lateral's argument, not in the WHERE: jsonb_array_elements() raises on
    -- a non-array input, and the planner is free to evaluate the lateral
    -- before a WHERE filter, so guarding after the fact would not save it.
    (select case when count(*) = 0 then null
                 else round(100.0 * count(*) filter (
                        where jsonb_array_length(coalesce(f->'source_ids', '[]'::jsonb)) > 0
                      ) / count(*))::int
            end
       from investigations i
       cross join lateral jsonb_array_elements(
         case when jsonb_typeof(i.findings) = 'array' then i.findings else '[]'::jsonb end
       ) as f
      where i.status = 'done'),

    -- Median wall-clock from submission to finished report — measured from
    -- created_at, not started_at, because the queue wait is part of what the
    -- reader actually experiences as "time to a report".
    (select percentile_cont(0.5) within group (
              order by extract(epoch from (finished_at - created_at))
            )::int
       from investigations
      where status = 'done'
        and finished_at is not null);
$$;

revoke all on function public_stats() from public;
grant execute on function public_stats() to anon, authenticated;
