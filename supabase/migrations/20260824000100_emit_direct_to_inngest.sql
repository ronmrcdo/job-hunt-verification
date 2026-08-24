-- Emit the Inngest event straight from pg_net; the Edge Function
-- `emit-investigation-requested` was a pure JSON reshaper and is deleted.
--
-- Secrets still never live in migration SQL: the base URL and event key are
-- operator-set database settings read at trigger time, exactly as the previous
-- app.settings.emit_investigation_url/_token were. Set them per environment:
--   alter database postgres set app.settings.inngest_base_url = 'http://inngest:8288';
--   alter database postgres set app.settings.inngest_event_key = '<INNGEST_EVENT_KEY>';
--
-- Two settings rather than one pre-joined URL so key rotation touches one value.
--
-- Both guards from 20260820010000 are preserved: unwired settings are a clean
-- no-op, and a missing pg_net warns instead of aborting the INSERT.
--
-- Note pg_net does NOT retry a failed POST. It never did — the Edge Function's
-- 502-so-the-caller-retries contract was not honored by pg_net either. The
-- delivery backstop is and remains sweep_stale_queued_fn (spec §6).

create or replace function emit_investigation_requested()
returns trigger language plpgsql as $$
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
