import { describe, it, expect, vi } from "vitest";

// page.tsx imports supabaseAdmin (real client at load) → stub it. It also
// pulls the "use server" action chain via ./triage; stub the auth + nav modules
// so the non-admin path is exercisable without a request context.
vi.mock("../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound, redirect: vi.fn() }));
vi.mock("../../../lib/admin/access", () => {
  class AdminAccessError extends Error {}
  return { AdminAccessError, assertAdmin: vi.fn(async () => { throw new AdminAccessError("denied"); }) };
});

import AdminConsolePage, { loadConsole } from "../page";

// A chainable PostgREST stand-in covering all four reads.
function fakeClient() {
  return {
    from(table: string) {
      if (table === "feedback") {
        return { select: () => ({ order: () => Promise.resolve({ data: [
          { id: "fb1", investigation_id: "inv1", verdict: "agree", wrong_finding_id: null, note: null, created_at: "2026-08-26T00:00:00Z" },
        ], error: null }) }) };
      }
      if (table === "investigations") {
        return {
          select: (_cols: string, opts?: { head?: boolean }) =>
            opts?.head
              ? Promise.resolve({ count: 57, error: null })
              : { in: () => Promise.resolve({ data: [{ id: "inv1", submission: {}, assessment: {}, findings: [] }], error: null }) },
        };
      }
      if (table === "eval_candidate") {
        // Two different reads hit this table: the Overview's status tally
        // (awaited straight off .select) and the export queue's
        // .select(...).eq("status","promoted"). The stand-in is thenable AND
        // chainable so one fake serves both.
        return {
          select: () => ({
            then: (res: (v: unknown) => unknown) =>
              res({ data: [{ status: "promoted" }, { status: "exported" }], error: null }),
            eq: () => Promise.resolve({ data: [{ id: "11111111-1111-1111-1111-111111111111" }], error: null }),
          }),
        };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: 1284, error: null }),
  } as never;
}

describe("loadConsole", () => {
  it("assembles Overview stats from all four reads and returns the triage result", async () => {
    const { stats, triage } = await loadConsole(fakeClient());
    expect(stats.registeredUsers).toBe(1284);
    expect(stats.investigationsTotal).toBe(57);
    expect(stats.feedback).toEqual({ total: 1, agree: 1, too_high: 0, too_low: 0 });
    expect(stats.candidates).toEqual({ total: 2, promoted: 1, exported: 1 });
    expect(triage.ok).toBe(true);
  });

  it("loads the candidates awaiting export alongside the triage queue", async () => {
    const { pending } = await loadConsole(fakeClient());
    expect(pending.ok).toBe(true);
    expect(pending.ok === true && pending.candidates).toHaveLength(1);
  });

  it("coalesces failed reads to zero and derives no verdicts from a failed triage read", async () => {
    const broken = {
      from(table: string) {
        if (table === "feedback") return { select: () => ({ order: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) };
        if (table === "investigations") return { select: () => Promise.resolve({ count: null, error: { message: "boom" } }) };
        if (table === "eval_candidate") return { select: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
        return {};
      },
      rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    } as never;
    const { stats, triage, pending } = await loadConsole(broken);
    expect(stats.registeredUsers).toBe(0);
    expect(stats.investigationsTotal).toBe(0);
    expect(stats.feedback.total).toBe(0);
    expect(stats.candidates.total).toBe(0);
    expect(triage.ok).toBe(false);
    expect(pending.ok).toBe(false); // a failed read is never an empty export queue
  });
});

describe("AdminConsolePage auth", () => {
  it("maps AdminAccessError to notFound (404, never 403)", async () => {
    await expect(AdminConsolePage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
