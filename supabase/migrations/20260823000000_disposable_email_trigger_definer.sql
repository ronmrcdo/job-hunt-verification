-- Fix: the auth.users BEFORE-INSERT trigger reject_disposable_email() ran with
-- invoker rights, so it executed as supabase_auth_admin (the role GoTrue uses to
-- insert new users). That role has no SELECT on public.blocked_email_domains, so
-- every signup aborted the transaction with the generic GoTrue message
-- "Database error saving new user" (Postgres: permission denied for table
-- blocked_email_domains). Match the rest of the auth/quota triggers: run it
-- SECURITY DEFINER (as owner) with a pinned search_path. CREATE OR REPLACE keeps
-- the existing trigger binding, so no trigger needs recreating.
create or replace function reject_disposable_email()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from blocked_email_domains
    where domain = lower(split_part(new.email, '@', 2))
  ) then
    raise sqlstate 'PT422' using message = 'email_domain_not_allowed';
  end if;
  return new;
end $$;
