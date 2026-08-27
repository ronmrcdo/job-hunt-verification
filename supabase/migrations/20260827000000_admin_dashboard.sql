-- Admin console (docs/superpowers/specs/2026-08-27-admin-dashboard-design.md):
-- a scoped registered-user counter + the eval_candidate read the Overview needs.

-- admin_ro cannot read auth.users and we do not want it to. A SECURITY DEFINER
-- function returns ONLY the scalar, so the role gains the count without row
-- access. search_path = '' + fully-qualified auth.users blocks search-path
-- hijacking, exactly as the feedback migration's triggers do.
create or replace function public.admin_registered_user_count()
returns integer
language sql
security definer
stable
set search_path = ''
as $$ select count(*)::integer from auth.users $$;

revoke execute on function public.admin_registered_user_count() from public;
grant execute on function public.admin_registered_user_count() to admin_ro;

-- Overview tallies eval_candidate by status; admin_ro has INSERT but not SELECT
-- on it (20260826130000). Add the read. Guarded so this migration is safe to
-- apply before/independent of the eval_candidate table's own migration.
do $$
begin
  if to_regclass('public.eval_candidate') is not null then
    execute 'grant select on public.eval_candidate to admin_ro';
  end if;
end $$;
