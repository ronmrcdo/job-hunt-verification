import { describe, it, expect, vi } from "vitest";

// toTriageRows is pure (inputs via args, no DB call), but page.tsx also
// imports supabaseAdmin, which constructs a real SupabaseClient at
// module-load time from process.env — unset under vitest. Stub it out the
// same way as actions.test.ts (see comment there).
vi.mock("../../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));

import { toTriageRows } from "../page";

describe("toTriageRows", () => {
  it("joins feedback to its investigation, newest first", () => {
    const feedback = [
      { id: "fb1", investigation_id: "inv1", verdict: "too_high", wrong_finding_id: null, note: "n1", created_at: "2026-08-25T00:00:00Z" },
      { id: "fb2", investigation_id: "inv2", verdict: "too_low", wrong_finding_id: "f_1", note: null, created_at: "2026-08-26T00:00:00Z" },
    ];
    const investigations = [
      { id: "inv1", submission: { job_text: "a" }, assessment: { band: "HIGH" }, findings: [] },
      { id: "inv2", submission: { job_text: "b" }, assessment: { band: "LOW" }, findings: [{ id: "f_1", claim: "c" }] },
    ];
    const rows = toTriageRows(feedback as never, investigations as never);
    expect(rows.map((r) => r.feedback.id)).toEqual(["fb2", "fb1"]); // newest first
    expect(rows[0].investigation?.assessment).toEqual({ band: "LOW" });
  });

  it("tolerates feedback whose investigation is missing", () => {
    const rows = toTriageRows(
      [{ id: "fb1", investigation_id: "gone", verdict: "agree", wrong_finding_id: null, note: null, created_at: "2026-08-26T00:00:00Z" }] as never,
      [] as never,
    );
    expect(rows[0].investigation).toBeNull();
  });
});
