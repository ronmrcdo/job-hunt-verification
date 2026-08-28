import { describe, it, expect } from "vitest";

import { loadPendingCandidates, loadAllCandidates, toExportPayload, parseCandidateIds, ExportError } from "../export";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";

// Chainable stand-in: the pending read is .select(...).eq("status","promoted").
function fakeClient(res: unknown) {
  const calls: { cols?: string; eq?: [string, string] } = {};
  const client = {
    from: () => ({
      select: (cols: string) => {
        calls.cols = cols;
        return {
          eq: (col: string, val: string) => {
            calls.eq = [col, val];
            return Promise.resolve(res);
          },
        };
      },
    }),
  } as never;
  return { client, calls };
}

describe("loadPendingCandidates", () => {
  it("reads only promoted rows, with every column the dataset case needs", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await loadPendingCandidates(client);
    expect(calls.eq).toEqual(["status", "promoted"]);
    for (const col of ["id", "investigation_id", "submission_snapshot", "expected_max_band", "expected_band", "tags"]) {
      expect(calls.cols).toContain(col);
    }
  });

  it("surfaces a read failure instead of reporting an empty queue", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied" } });
    const res = await loadPendingCandidates(client);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/permission denied/);
  });

  it("returns the pending candidates when the read succeeds", async () => {
    const { client } = fakeClient({ data: [{ id: ID_A }], error: null });
    const res = await loadPendingCandidates(client);
    expect(res.ok === true && res.candidates).toEqual([{ id: ID_A }]);
  });
});

describe("toExportPayload", () => {
  it("wraps the candidates in the envelope the promote script accepts", () => {
    const payload = toExportPayload([{ id: ID_A }] as never, "2026-08-28T00:00:00.000Z");
    expect(payload).toEqual({ generated_at: "2026-08-28T00:00:00.000Z", candidates: [{ id: ID_A }] });
  });
});

describe("parseCandidateIds", () => {
  it("accepts the comma-separated line the promote script prints", () => {
    expect(parseCandidateIds(`${ID_A},${ID_B}`)).toEqual([ID_A, ID_B]);
  });

  it("tolerates whitespace and newlines from a sloppy paste, and de-duplicates", () => {
    expect(parseCandidateIds(` ${ID_A} ,\n${ID_B}\n${ID_A} `)).toEqual([ID_A, ID_B]);
  });

  it("rejects anything that is not a uuid rather than silently dropping it", () => {
    // Silently skipping a malformed id would leave that candidate stuck as
    // 'promoted' forever while the operator believes it was marked.
    expect(() => parseCandidateIds(`${ID_A},feedback_1111_2222`)).toThrow(ExportError);
    expect(() => parseCandidateIds(`${ID_A},feedback_1111_2222`)).toThrow(/feedback_1111_2222/);
  });

  it("rejects an empty paste", () => {
    expect(() => parseCandidateIds("   \n ")).toThrow(ExportError);
  });
});

// A candidate read with no .eq() filter: select(...) resolves directly.
function fakeAllClient(res: unknown) {
  const calls: { cols?: string } = {};
  const client = {
    from: () => ({
      select: (cols: string) => {
        calls.cols = cols;
        return Promise.resolve(res);
      },
    }),
  } as never;
  return { client, calls };
}

describe("loadAllCandidates", () => {
  it("reads every candidate with the columns the queue's status badge needs", async () => {
    const { client, calls } = fakeAllClient({ data: [], error: null });
    await loadAllCandidates(client);
    for (const col of ["investigation_id", "status", "expected_max_band", "tags", "exported_at"]) {
      expect(calls.cols).toContain(col);
    }
  });

  it("returns null on a failed read, so an unknown status is never rendered as 'not promoted'", async () => {
    const { client } = fakeAllClient({ data: null, error: { message: "permission denied" } });
    expect(await loadAllCandidates(client)).toBeNull();
  });

  it("returns null when the read throws at the network layer", async () => {
    const client = { from: () => ({ select: () => Promise.reject(new Error("ECONNRESET")) }) } as never;
    expect(await loadAllCandidates(client)).toBeNull();
  });

  it("returns the rows when the read succeeds", async () => {
    const rows = [{ investigation_id: "inv1", status: "promoted", expected_max_band: "HIGH", tags: [], exported_at: null }];
    const { client } = fakeAllClient({ data: rows, error: null });
    expect(await loadAllCandidates(client)).toEqual(rows);
  });
});
