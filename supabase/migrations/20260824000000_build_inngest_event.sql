-- The Inngest event builder, ported from the deleted Edge Function's
-- `buildInngestEvent` (supabase/functions/emit-investigation-requested/event.ts).
-- Kept as its own function rather than inlined into the trigger so it stays
-- unit-testable — see apps/api/tests/sql/test_emit_event.py.
--
-- `id` is deliberately the investigation id: it is Inngest's idempotency key,
-- which sweep_stale_queued_fn relies on when it re-emits stale queued rows.

create or replace function build_inngest_event(inv_id uuid)
returns jsonb language plpgsql immutable as $$
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
