import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyStepEvent, applyStatusEvent, isTerminal, useInvestigationLive } from "../investigations-live";
import type { InvestigationStep, Investigation } from "../investigations";
import { renderHook } from "@testing-library/react";

const { getInvestigation, mockChannel, removeChannel } = vi.hoisted(() => {
  const getInv = vi.fn();
  const mockChan = {
    on: vi.fn(function (this: any) { return this; }),
    subscribe: vi.fn(function (this: any, cb: (status: string) => void) {
      cb("SUBSCRIBED");
      return this;
    }),
  };
  const removeChann = vi.fn();
  return { getInvestigation: getInv, mockChannel: mockChan, removeChannel: removeChann };
});

const step = (k: string, order: number, status: string): InvestigationStep => ({
  investigation_id: "i1",
  step_key: k,
  label: k,
  display_order: order,
  status,
  started_at: null,
  finished_at: null,
});

vi.mock("../supabase/client", () => ({
  createClient: () => ({
    channel: vi.fn(() => mockChannel),
    removeChannel,
  }),
}));

vi.mock("../investigations", () => ({
  getInvestigation,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getInvestigation.mockResolvedValue({
    investigation: { id: "i1", status: "running" },
    steps: [],
  });
});

describe("applyStepEvent", () => {
  it("inserts a new step and keeps display_order sorting", () => {
    const out = applyStepEvent([step("b", 2, "pending")], step("a", 1, "running"));
    expect(out.map((s) => s.step_key)).toEqual(["a", "b"]);
  });
  it("updates an existing step in place by step_key", () => {
    const out = applyStepEvent([step("a", 1, "pending")], step("a", 1, "done"));
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("done");
  });
  it("does not regress a done step back to running", () => {
    const done = [{ step_key: "intake", display_order: 1, status: "done" }] as any;
    const stale = { step_key: "intake", display_order: 1, status: "running" } as any;
    const next = applyStepEvent(done, stale);
    expect(next.find((s) => s.step_key === "intake")!.status).toBe("done");
  });
  it("still advances pending → running → done", () => {
    let steps = [{ step_key: "intake", display_order: 1, status: "pending" }] as any;
    steps = applyStepEvent(steps, { step_key: "intake", display_order: 1, status: "running" } as any);
    steps = applyStepEvent(steps, { step_key: "intake", display_order: 1, status: "done" } as any);
    expect(steps[0].status).toBe("done");
  });
});

describe("useInvestigationLive", () => {
  it("re-selects once the channel reports SUBSCRIBED", async () => {
    const initial = {
      investigation: { id: "i1", status: "running" } as Investigation,
      steps: [] as InvestigationStep[],
    };
    renderHook(() => useInvestigationLive("i1", initial));
    // Give the effect time to run and the subscription callback to be invoked
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getInvestigation).toHaveBeenCalled();
  });
});

describe("applyStatusEvent", () => {
  it("merges the new status without dropping other fields", () => {
    const inv = { id: "i1", status: "running", check_count: 3 } as Investigation;
    expect(applyStatusEvent(inv, { status: "done" })).toMatchObject({ status: "done", check_count: 3 });
  });
});

describe("isTerminal", () => {
  it("is true for done/failed/deadline_exceeded only", () => {
    expect(["done", "failed", "deadline_exceeded"].every(isTerminal)).toBe(true);
    expect(["queued", "running"].some(isTerminal)).toBe(false);
  });
});
