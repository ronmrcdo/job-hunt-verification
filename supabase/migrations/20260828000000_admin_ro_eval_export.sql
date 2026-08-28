-- Eval export handoff: production Postgres sits on an internal Coolify network
-- with no route from an operator laptop, so scripts/promote_feedback.py cannot
-- reach eval_candidate directly. The candidates instead leave through /admin as
-- a JSON download, and the operator marks them exported from the same console
-- once the dataset PR merges.
--
-- That last step is the only new privilege: admin_ro (20260826130000) has
-- SELECT + INSERT on eval_candidate but no UPDATE. Grant UPDATE on exactly the
-- two columns the status flip touches — column-level, so a leaked
-- SUPABASE_ADMIN_KEY still cannot rewrite a candidate's submission_snapshot,
-- expected band, or tags, i.e. it cannot forge what lands in the eval dataset.
--
-- Idempotent + existence-guarded, matching the other admin_ro migrations.
do $$
begin
  if to_regclass('public.eval_candidate') is not null then
    execute 'grant update (status, exported_at) on public.eval_candidate to admin_ro';
  end if;
end $$;
