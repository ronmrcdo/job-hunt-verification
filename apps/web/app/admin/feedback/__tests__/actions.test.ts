import { describe, it, expect, vi } from "vitest";

// buildCandidate is pure (inputs via args, no DB call), but actions.ts is a
// "use server" module that also imports supabaseAdmin, which constructs a
// real SupabaseClient at module-load time from process.env — unset under
// vitest. Stub it out with an explicit factory (not bare auto-mock, which can
// still execute the module's top-level createClient) so importing the pure
// fn doesn't blow up on an unrelated DB client. The promote()/DB path stays
// untested here (integration-only), consistent with the repo's convention.
vi.mock("../../../../lib/supabase/admin", () => ({ supabaseAdmin: {} }));

import { buildCandidate, PromoteError } from "../actions";
import type { Investigation } from "../../../../lib/investigations";

const INV = {
  id: "11112222-3333-4444-5555-666677778888",
  user_id: "u1",
  status: "done",
  title: null,
  entities: null,
  submission: { job_text: "hi", company_name: "Acme", recruiter_email: "t@acme.com" },
  assessment: { band: "HIGH", confidence: "MODERATE", summary: "s", coverage: 0.5 },
  findings: [
    { id: "f_company_01", category: "company", direction: "suspicious", severity: "high", claim: "x", source_ids: [], provenance: "web_verified", mitigation: null },
  ],
  sources: null,
  cost: null,
  what_to_verify: null,
  check_count: 1,
} as unknown as Investigation;

describe("buildCandidate", () => {
  it("copies the submission snapshot and stamps promoter + tags", () => {
    const c = buildCandidate(INV, { expectedMaxBand: "MODERATE", tags: ["legit"], wrongFindingId: null, promotedBy: "ron@example.com" });
    expect(c).toEqual({
      investigation_id: INV.id,
      submission_snapshot: INV.submission,
      expected_max_band: "MODERATE",
      tags: ["legit"],
      promoted_by: "ron@example.com",
    });
  });

  it("accepts a wrong_finding_id that references a real finding", () => {
    const c = buildCandidate(INV, { expectedMaxBand: "LOW", tags: [], wrongFindingId: "f_company_01", promotedBy: "ron@example.com" });
    // wrong_finding_id is not stored on the candidate (it's a triage signal),
    // but validation must pass without throwing.
    expect(c.expected_max_band).toBe("LOW");
  });

  it("rejects a wrong_finding_id absent from the investigation's findings", () => {
    expect(() =>
      buildCandidate(INV, { expectedMaxBand: "LOW", tags: [], wrongFindingId: "f_ghost_99", promotedBy: "ron@example.com" }),
    ).toThrow(PromoteError);
  });

  it("rejects an out-of-enum band", () => {
    expect(() =>
      buildCandidate(INV, { expectedMaxBand: "SEVERE" as never, tags: [], wrongFindingId: null, promotedBy: "ron@example.com" }),
    ).toThrow(PromoteError);
  });
});
