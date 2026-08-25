-- Supabase security advisor remediation.
--
-- Two independent hardening items, neither of which changes behavior:
--
--  (1) ERROR "RLS Disabled in Public" on public.blocked_email_domains.
--      20260821122000_disposable_email_block.sql created the table but never
--      enabled RLS, so PostgREST exposes its rows to anon/authenticated. Its
--      only reader, reject_disposable_email(), runs SECURITY DEFINER (owner,
--      since 20260823000000) and BYPASSES RLS, so deny-all RLS here is
--      invisible to signups — it only closes the default public grants. This
--      brings the table in line with the worker tables (20260819081000) and
--      app_settings (20260821130000): RLS on, zero policies, grants revoked.
--
--  (2) WARNING "Function Search Path Mutable" on emit_investigation_requested,
--      stamp_investigation_finished, force_investigation_defaults, and
--      build_inngest_event. The repo already pins search_path on app_setting()
--      and reject_disposable_email(); these four were simply missed. Each is
--      re-asserted below with its current body unchanged plus
--      `set search_path = public`. All table/function references they use live
--      in public, and net.http_post is already schema-qualified, so pinning to
--      public is behavior-preserving.
-- OPERATOR: apply after 20260825000000_dedup_and_serialize_check_quota.sql.

-- ---------------------------------------------------------------------------
-- (1) blocked_email_domains: deny-all RLS (matches app_settings / worker tables)
-- ---------------------------------------------------------------------------
alter table blocked_email_domains enable row level security;
-- No client policy: reject_disposable_email() reads it as owner (SECURITY
-- DEFINER); clients never read it. Zero policies => anon/authenticated get
-- zero rows. Revoke the default public grants too.
revoke all on blocked_email_domains from anon, authenticated;

-- ---------------------------------------------------------------------------
-- (2) Pin search_path on the four flagged functions. Bodies are verbatim from
-- their latest definitions; only `set search_path = public` is added.
-- ---------------------------------------------------------------------------

-- from 20260824000100_emit_direct_to_inngest.sql
create or replace function emit_investigation_requested()
returns trigger language plpgsql
set search_path = public
as $$
declare
  base_url  text := current_setting('app.settings.inngest_base_url', true);
  event_key text := current_setting('app.settings.inngest_event_key', true);
begin
  if base_url is null or base_url = '' or event_key is null or event_key = '' then
    return new;  -- not wired in this environment: no-op, never block the insert.
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise warning
      'emit_investigation_requested: pg_net (net schema) absent; skipping emission for investigation %. Run: create extension if not exists pg_net;',
      new.id;
    return new;
  end if;

  perform net.http_post(
    url     := rtrim(base_url, '/') || '/e/' || event_key,
    body    := build_inngest_event(new.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
end $$;

-- from 20260821140000_public_stats.sql
create or replace function stamp_investigation_finished()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.status in ('done', 'failed', 'deadline_exceeded') and new.finished_at is null then
    new.finished_at := now();
  end if;
  return new;
end $$;

-- from 20260822000000_investigations_entities.sql (latest body, entities nulled)
create or replace function force_investigation_defaults()
returns trigger language plpgsql
set search_path = public
as $$
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

-- from 20260824000000_build_inngest_event.sql
create or replace function build_inngest_event(inv_id uuid)
returns jsonb language plpgsql immutable
set search_path = public
as $$
begin
  if inv_id is null then
    raise exception 'build_inngest_event: investigation id is null';
  end if;
  return jsonb_build_object(
    'name', 'investigation.requested',
    'id', inv_id::text,
    'data', jsonb_build_object('investigation_id', inv_id::text)
  );
end $$;
