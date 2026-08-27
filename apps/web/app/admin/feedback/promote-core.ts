// Pure, framework-free core for the feedback→eval promotion. Kept OUT of
// actions.ts on purpose: that file carries the "use server" directive, under
// which every export must be an async server action — a class, a plain type,
// or a sync function there fails the build ("Only async functions are allowed
// to be exported in a 'use server' file"). This module has no directive, so it
// can export the error type and the sync builder, and it stays trivially
// unit-testable (no DB client at module load).
import type { Investigation } from "../../../lib/investigations";

export class PromoteError extends Error {}

const BANDS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type Band = (typeof BANDS)[number];

export interface PromoteInput {
  expectedMaxBand: Band;
  tags: string[];
  wrongFindingId: string | null;
  promotedBy: string;
}

// Turn an investigation + admin correction into the eval_candidate INSERT row.
// wrong_finding_id is validated HERE against the referenced investigation's
// real findings (spec Global Constraints: never trust it from the client),
// then dropped — it's a triage signal, not part of the dataset case.
// submission_snapshot is copied so a later investigation edit can't mutate a
// pending case.
export function buildCandidate(inv: Investigation, input: PromoteInput) {
  if (!BANDS.includes(input.expectedMaxBand)) {
    throw new PromoteError(`bad expected_max_band: ${input.expectedMaxBand}`);
  }
  if (input.wrongFindingId) {
    const ids = new Set((inv.findings ?? []).map((f) => f.id));
    if (!ids.has(input.wrongFindingId)) {
      throw new PromoteError(`wrong_finding_id ${input.wrongFindingId} not in investigation ${inv.id}`);
    }
  }
  return {
    investigation_id: inv.id,
    submission_snapshot: inv.submission,
    expected_max_band: input.expectedMaxBand,
    tags: input.tags,
    promoted_by: input.promotedBy,
  };
}
