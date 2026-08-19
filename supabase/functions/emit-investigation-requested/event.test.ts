import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildInngestEvent } from "./event.ts";

Deno.test("maps an INSERT webhook to investigation.requested with id = row id", () => {
  const payload = { type: "INSERT", table: "investigations", record: { id: "abc-123" } };
  const evt = buildInngestEvent(payload);
  assertEquals(evt, {
    name: "investigation.requested",
    id: "abc-123",                       // idempotency key = investigation id
    data: { investigation_id: "abc-123" },
  });
});

Deno.test("throws on a payload with no record id", () => {
  let threw = false;
  try { buildInngestEvent({ type: "INSERT", table: "investigations", record: {} } as never); }
  catch { threw = true; }
  assertEquals(threw, true);
});
