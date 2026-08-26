-- Feedback→eval-loop (Component 5): a least-privilege principal for the
-- server-only admin client, instead of handing /admin/* the god-mode
-- service_role key. `admin_ro` bypasses RLS (so the feedback triage queue can
-- read across users) but is granted ONLY the reads it needs plus the single
-- insert it performs — no delete, no update, no access to any other table. If
-- SUPABASE_ADMIN_KEY (a JWT minting this role) ever leaks, the blast radius is
-- "read feedback/investigations + insert eval candidates", not "wipe or
-- exfiltrate the whole database" the way a leaked service_role key would be.
--
-- Idempotent: guarded create + existence-checked grants so re-running
-- `db push --include-all` is safe.

-- The role itself. NOLOGIN (PostgREST switches into it via SET ROLE, never
-- logs in as it), NOINHERIT, BYPASSRLS for the cross-user triage reads.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'admin_ro') then
    create role admin_ro nologin noinherit bypassrls;
  end if;
end $$;

-- PostgREST logs in as `authenticator` and SET ROLEs into whatever the JWT's
-- `role` claim names, so the role must be reachable from authenticator.
grant admin_ro to authenticator;

-- investigations exists today; the admin queue reads it to show the run behind
-- each feedback row.
grant select on public.investigations to admin_ro;

-- feedback / eval_candidate are created by the feedback→eval-loop migrations
-- (Components 1 & 2), which may not be applied yet. Guard the grants so this
-- migration is safe to apply on its own; they activate once the tables exist
-- (re-run this migration, or fold these two grants into those tables' own
-- migrations). NOTE the asymmetry: SELECT on feedback (read-only), INSERT on
-- eval_candidate (append-only) — never delete/update on either.
do $$
begin
  if to_regclass('public.feedback') is not null then
    execute 'grant select on public.feedback to admin_ro';
  end if;
  if to_regclass('public.eval_candidate') is not null then
    execute 'grant insert on public.eval_candidate to admin_ro';
  end if;
end $$;
