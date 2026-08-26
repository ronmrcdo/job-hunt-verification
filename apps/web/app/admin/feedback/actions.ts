"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { assertAdmin } from "../../../lib/admin/access";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import type { Investigation } from "../../../lib/investigations";

export class PromoteError extends Error {}

const BANDS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
type Band = (typeof BANDS)[number];

export interface PromoteInput {
  expectedMaxBand: Band;
  tags: string[];
  wrongFindingId: string | null;
  promotedBy: string;
}

// Pure, testable core: turn an investigation + admin correction into the
// eval_candidate INSERT row. wrong_finding_id is validated HERE against the
// referenced investigation's real findings (spec Global Constraints: never
// trust it from the client), then dropped — it's a triage signal, not part of
// the dataset case. submission_snapshot is copied so a later investigation edit
// can't mutate a pending case.
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

export async function promote(formData: FormData) {
  const email = await assertAdmin(await headers()); // throws -> caller shows 404
  const investigationId = String(formData.get("investigation_id") ?? "");
  const expectedMaxBand = String(formData.get("expected_max_band") ?? "") as Band;
  const wrongFindingId = (formData.get("wrong_finding_id") as string | null) || null;
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const { data: inv, error } = await supabaseAdmin
    .from("investigations")
    .select("id, submission, findings")
    .eq("id", investigationId)
    .single();
  if (error || !inv) throw new PromoteError(`investigation ${investigationId} not found`);

  const candidate = buildCandidate(inv as unknown as Investigation, {
    expectedMaxBand,
    tags,
    wrongFindingId,
    promotedBy: email,
  });

  const { error: insErr } = await supabaseAdmin.from("eval_candidate").insert(candidate);
  if (insErr) throw new PromoteError(insErr.message);

  revalidatePath("/admin/feedback");
}
