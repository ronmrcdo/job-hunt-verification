import { describe, it, expect, vi } from "vitest";
import { createInvestigation, getInvestigation, recentInvestigations } from "../investigations";

// Minimal chainable stub. Each terminal (`.single()`, awaited select) resolves
// with the queued script entry.
function fakeClient(script: Record<string, any>) {
  const calls: any[] = [];
  const builder = (table: string) => {
    const ctx: any = { table, filters: {}, _order: null, _limit: null };
    const chain: any = {
      insert: (v: any) => ((ctx.op = "insert"), (ctx.value = v), chain),
      select: (c?: string) => ((ctx.op ??= "select"), (ctx.columns = c), chain),
      eq: (col: string, val: any) => ((ctx.filters[col] = val), chain),
      order: (col: string, o: any) => ((ctx._order = [col, o]), chain),
      limit: (n: number) => ((ctx._limit = n), chain),
      single: () => (calls.push(ctx), Promise.resolve(script[`${table}:single`] ?? { data: null, error: null })),
      then: (res: any) => (calls.push(ctx), Promise.resolve(script[table] ?? { data: [], error: null }).then(res)),
    };
    return chain;
  };
  return { from: builder, _calls: calls } as any;
}

describe("createInvestigation", () => {
  it("inserts submission and returns the new id", async () => {
    const client = fakeClient({ "investigations:single": { data: { id: "new-id" }, error: null } });
    const r = await createInvestigation(client, { job_text: "x" });
    expect(r).toEqual({ id: "new-id" });
    const insert = client._calls.find((c: any) => c.op === "insert");
    expect(insert.value).toMatchObject({ submission: { job_text: "x" } });
  });
  it("returns an error message on constraint violation", async () => {
    const client = fakeClient({
      "investigations:single": { data: null, error: { message: "violates check constraint" } },
    });
    const r = await createInvestigation(client, { job_text: "" });
    expect(r).toHaveProperty("error");
  });
});

describe("getInvestigation", () => {
  // RLS boundary (backend spec §4): another user's row is invisible under
  // investigations_select_own, so the SELECT returns zero rows — never an
  // error. The client relies on this null to render not-found rather than
  // leaking existence. This test pins that contract on the web side; the DB
  // enforcement itself is proven by scripts/verify_rls.sql (operator-run).
  it("returns null when the row is absent or RLS-denied (0 rows, no error)", async () => {
    const client = fakeClient({ "investigations:single": { data: null, error: null } });
    expect(await getInvestigation(client, "missing")).toBeNull();
  });
  it("does not surface a row when RLS yields no data even if a benign error is set", async () => {
    const client = fakeClient({
      "investigations:single": { data: null, error: { code: "PGRST116", message: "0 rows" } },
    });
    expect(await getInvestigation(client, "someone-elses-id")).toBeNull();
  });
  it("returns the row and its steps when present", async () => {
    const client = fakeClient({
      "investigations:single": { data: { id: "i1", status: "done", submission: {} }, error: null },
      investigation_steps: { data: [{ step_key: "intake", display_order: 1 }], error: null },
    });
    const out = await getInvestigation(client, "i1");
    expect(out?.investigation.id).toBe("i1");
    expect(out?.steps).toHaveLength(1);
  });
});

describe("recentInvestigations", () => {
  it("orders by created_at desc and limits", async () => {
    const client = fakeClient({ investigations: { data: [{ id: "a" }, { id: "b" }], error: null } });
    const out = await recentInvestigations(client, 5);
    expect(out).toHaveLength(2);
    const q = client._calls.find((c: any) => c.op === "select");
    expect(q._order).toEqual(["created_at", { ascending: false }]);
    expect(q._limit).toBe(5);
  });
});
