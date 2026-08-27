"use server";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertAdmin, AdminAccessError } from "../../../lib/admin/access";
import { supabaseAdmin } from "../../../lib/supabase/admin";
import type { Investigation } from "../../../lib/investigations";
// PromoteError/buildCandidate live in promote-core.ts, not here: a "use server"
// file may export only async server actions, so the error class and the sync
// builder can't be declared in this module.
import { buildCandidate, PromoteError, type Band } from "./promote-core";

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

  // admin_ro has INSERT but deliberately NO SELECT on eval_candidate, so this
  // insert must stay SELECT-less — never chain `.select()` here, it would
  // 403 at runtime.
  const { error: insErr } = await supabaseAdmin.from("eval_candidate").insert(candidate);
  if (insErr) throw new PromoteError(insErr.message);

  revalidatePath("/admin/feedback");
}
