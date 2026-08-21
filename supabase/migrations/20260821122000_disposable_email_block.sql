-- Signup gate (spec §4.4): reject sign-ups from known disposable-email domains
-- so an account farm can't cheaply mint verified accounts to harvest 3 checks
-- each. Trigger on auth.users (the standard Supabase auth-schema trigger
-- pattern). Refresh the seed list periodically (see RUNBOOK).
create table if not exists blocked_email_domains (domain text primary key);

insert into blocked_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('10minutemail.com'),
  ('tempmail.com'), ('trashmail.com'), ('yopmail.com'), ('getnada.com'),
  ('dispostable.com'), ('maildrop.cc'), ('sharklasers.com')
on conflict do nothing;

create or replace function reject_disposable_email()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from blocked_email_domains
    where domain = lower(split_part(new.email, '@', 2))
  ) then
    raise sqlstate 'PT422' using message = 'email_domain_not_allowed';
  end if;
  return new;
end $$;

create trigger trg_reject_disposable_email before insert on auth.users
  for each row execute function reject_disposable_email();
