-- Component 2: the staging area between "admin approved" and "in the dataset".
-- Internal table — deny-all under RLS (like cache/checkpoints). Reached only by
-- the server-only privileged client (INSERT via admin_ro) and the operator
-- promotion script (SELECT/UPDATE via a privileged DB connection). No client
-- principal touches it. submission_snapshot is copied at promote time so a later
-- investigation edit can't mutate a pending case.
create table if not exists eval_candidate (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references investigations(id) on delete cascade,
  submission_snapshot jsonb not null,
  expected_max_band text not null check (expected_max_band in ('LOW','MODERATE','HIGH','CRITICAL')),
  expected_band text check (expected_band is null or expected_band in ('LOW','MODERATE','HIGH','CRITICAL')),
  tags text[] not null default '{}',
  status text not null default 'promoted' check (status in ('promoted','exported')),
  promoted_by text not null,
  created_at timestamptz not null default now(),
  exported_at timestamptz
);

-- Deny-all: RLS on, zero policies. anon/authenticated can neither see nor write
-- it; admin_ro (INSERT grant, 20260826130000) and the operator script
-- (privileged connection) bypass RLS.
alter table eval_candidate enable row level security;

-- NOTE: no admin_ro grant here — see 20260826130000_admin_ro_role.sql, whose
-- guarded block grants INSERT on this table once it exists.

-- At most one PENDING (not-yet-exported) candidate per investigation, so a
-- redundant double-promote of the same investigation is rejected at the DB.
-- Partial (status = 'promoted' only): once a candidate is exported its status
-- flips to 'exported' and the index no longer applies, so a genuinely new
-- candidate for an already-exported investigation is still allowed.
create unique index if not exists eval_candidate_one_pending_per_investigation
  on eval_candidate (investigation_id) where status = 'promoted';
