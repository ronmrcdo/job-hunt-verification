-- Operator/admin grant of top-up checks (spec §4.7). service_role only — the
-- seam a future purchase/billing flow would credit into. n may be negative to
-- claw back. NOTE: Postgres checks the column's `>= 0` constraint against the
-- raw VALUES tuple during ON CONFLICT's speculative insert, before conflict
-- resolution, so a literal negative n in VALUES would raise even when the
-- update nets non-negative. Floor the VALUES tuple with greatest(n,0) (safe on
-- the no-conflict insert path — a brand-new row cannot be clawed below 0) and
-- do the real arithmetic in the DO UPDATE using the parameter n directly (NOT
-- excluded.top_up_balance, which equals the floored value). The final updated
-- row is still checked, so a claw-back below zero (existing + n < 0) raises
-- check_violation as intended.
create or replace function grant_top_up(target_user uuid, n int)
returns int language plpgsql security definer
set search_path = public
as $$
declare new_balance int;
begin
  insert into user_check_quota (user_id, top_up_balance)
  values (target_user, greatest(n, 0))
  on conflict (user_id) do update
    set top_up_balance = user_check_quota.top_up_balance + n,
        updated_at = now()
  returning top_up_balance into new_balance;
  return new_balance;
end $$;

revoke all on function grant_top_up(uuid, int) from public, anon, authenticated;
grant execute on function grant_top_up(uuid, int) to service_role;
