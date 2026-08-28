"use server";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertAdmin, AdminAccessError } from "../../lib/admin/access";
import { supabaseAdmin } from "../../lib/supabase/admin";
import type { Investigation } from "../../lib/investigations";
// PromoteError/buildCandidate live in promote-core.ts, not here: a "use server"
// file may export only async server actions, so the error class and the sync
// builder can't be declared in this module.
import { buildCandidate, PromoteError, type Band } from "./promote-core";
import { ExportError, parseCandidateIds } from "./export";

export async function promote(formData: FormData) {
  let email: string;
  try {
    email = await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403 (no existence leak)
    throw e;
  }
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

  // Keep the write path minimal — never chain `.select()` here. The Overview's
  // read-only SELECT grant on eval_candidate is unrelated to this insert, which
  // stays a bare INSERT (one row in, nothing read back).
  const { error: insErr } = await supabaseAdmin.from("eval_candidate").insert(candidate);
  if (insErr) throw new PromoteError(insErr.message);

  revalidatePath("/admin"); // the console now hosts the queue
}

// Second half of the eval export handoff: the operator downloaded the pending
// candidates from /admin/export, merged them into eval/dataset.json locally with
// `promote_feedback.py --from-file`, and the PR has now MERGED. Only then does
// the queue get drained, by pasting back the ids that script printed.
//
// Deliberately id-driven rather than a "mark everything promoted" button: a
// candidate promoted between the download and the merge must not be flipped to
// exported, or its case never reaches the dataset and is never offered again.
export async function markExported(formData: FormData) {
  try {
    await assertAdmin(await headers());
  } catch (e) {
    if (e instanceof AdminAccessError) notFound(); // 404, never 403
    throw e;
  }

  const ids = parseCandidateIds(String(formData.get("candidate_ids") ?? ""));

  // `.eq("status", "promoted")` makes this a no-op on already-exported rows, so
  // a double submit cannot rewrite an earlier export's timestamp.
  const { error } = await supabaseAdmin
    .from("eval_candidate")
    .update({ status: "exported", exported_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "promoted");
  if (error) throw new ExportError(error.message);

  revalidatePath("/admin");
}
