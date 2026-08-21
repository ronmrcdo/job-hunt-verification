-- Harden the investigations emit trigger against a missing pg_net.
--
-- Why: on the local Supabase stack, `supabase stop/start` preserves the
-- migration history AND the db-level `app.settings.emit_investigation_url`
-- GUC (it lives in pg_db_role_setting), but does NOT preserve the `pg_net`
-- extension — the `net` schema is gone after a restart. Because the
-- investigations_v1 migration is already marked applied, its
-- `create extension if not exists pg_net` never re-runs, so the URL setting
-- and the `net` schema diverge: the trigger sees a non-empty URL, calls
-- `net.http_post`, and aborts EVERY insert into investigations with
--   ERROR: schema "net" does not exist
-- i.e. "We couldn't start the check." on every attempt after a restart.
--
-- Fix: mirror the existing "URL unset -> no-op" guard with a "net absent ->
-- no-op" guard. If pg_net isn't loaded, skip emission (the §6 sweeper or a
-- manual event replay is the backstop) instead of failing the insert. The
-- `perform net.http_post` reference is resolved lazily by plpgsql only when
-- that statement runs, so guarding it behind the existence check is safe.
--
-- To restore automatic emission after a restart that dropped pg_net, simply
-- re-create it:  create extension if not exists pg_net;

create or replace function emit_investigation_requested()
returns trigger language plpgsql as $$
declare
  emit_url text := current_setting('app.settings.emit_investigation_url', true);
  emit_token text := current_setting('app.settings.emit_investigation_token', true);
  headers jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  if emit_url is null or emit_url = '' then
    return new;  -- webhook not wired in this environment: no-op, never block the insert.
  end if;
  -- pg_net may be absent even though the URL setting persisted (local
  -- stop/start drops the extension). Skip emission rather than aborting the
  -- insert on a missing `net` schema.
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise warning
      'emit_investigation_requested: pg_net (net schema) absent; skipping emission for investigation %. Run: create extension if not exists pg_net;',
      new.id;
    return new;
  end if;
  if emit_token is not null and emit_token <> '' then
    headers := headers || jsonb_build_object('Authorization', 'Bearer ' || emit_token);
  end if;
  -- pg_net delivers asynchronously via its background worker; the payload
  -- mirrors Supabase's Database-Webhook body so the Edge Function's
  -- WebhookPayload ({type, table, record.id}) is satisfied unchanged.
  perform net.http_post(
    url := emit_url,
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', jsonb_build_object('id', new.id)
    ),
    headers := headers
  );
  return new;
end $$;
