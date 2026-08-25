import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { SubmissionInput } from "./validation";

export type Source = {
  id: string;
  url: string | null;
  kind: "search_result" | "fetched_page" | "whois" | "dns" | "user_provided";
  retrieved_at: string;
  content_summary: string;
  raw_excerpt: string | null;
};
export type Finding = {
  id: string;
  category: "company" | "job" | "recruiter" | "domain" | "communication" | "cross_source";
  direction: "legitimizing" | "suspicious" | "unverifiable";
  severity: "info" | "low" | "medium" | "high" | "critical";
  claim: string;
  source_ids: string[];
  provenance: "web_verified" | "deterministic" | "user_provided_unverified";
  mitigation: string | null;
};
export type FinalAssessment = {
  band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  confidence: "LOW" | "MODERATE" | "HIGH";
  summary: string;
  coverage: number;
};
export type Submission = {
  job_text: string;
  company_name?: string;
  recruiter_email?: string;
  job_url?: string;
};
// Worker-extracted display entities (written by the intake node, whitelisted
// and defanged by persistence.display_entities). Null when the posting named
// none of them, and null for every run that finished before the entities
// column existed — the view model treats both the same.
export type Entities = {
  company_name?: string | null;
  job_title?: string | null;
  salary?: string | null;
  recruiter_name?: string | null;
  contact_channel?: string | null;
};
export type Investigation = {
  id: string;
  user_id: string;
  status: string;
  // Worker-derived display label (extracted company name, else job title);
  // null when the posting named neither — the UI renders "Untitled posting".
  title: string | null;
  entities: Entities | null;
  submission: Submission;
  assessment: FinalAssessment | null;
  findings: Finding[] | null;
  sources: Source[] | null;
  cost: Record<string, unknown> | null;
  what_to_verify: string[] | null;
  check_count: number | null;
  created_at: string;
};
export type InvestigationStep = {
  investigation_id: string;
  step_key: string;
  label: string;
  display_order: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
};

type Client = SupabaseClient<Database>;

export type QuotaStatus = {
  weeklyUsed: number;
  weeklyLimit: number;
  resetsAt: string | null;
  topUpBalance: number;
};

/**
 * Shared derivation of what a QuotaStatus means for the UI: how many weekly
 * checks remain, the bonus (top-up) balance, and whether BOTH buckets are
 * empty — the only state that blocks a new check, since a bonus check keeps
 * submit live. One source of truth for the form's submit gate and the
 * QuotaMeter's display so "exhausted" can't drift between them.
 */
export function quotaView(quota: QuotaStatus): {
  weeklyRemaining: number;
  topUp: number;
  exhausted: boolean;
} {
  const weeklyRemaining = Math.max(quota.weeklyLimit - quota.weeklyUsed, 0);
  const topUp = quota.topUpBalance ?? 0;
  return { weeklyRemaining, topUp, exhausted: weeklyRemaining === 0 && topUp === 0 };
}

export async function quotaStatus(client: Client): Promise<QuotaStatus> {
  // `quota_status` is a DB RPC not present in the hand-authored Database types;
  // cast narrowly (same pattern as the `as unknown as` casts elsewhere here).
  const { data } = await (client.rpc as unknown as (fn: string) => {
    single: () => Promise<{
      data: {
        weekly_used?: number;
        weekly_limit?: number;
        resets_at?: string | null;
        top_up_balance?: number;
      } | null;
    }>;
  })("quota_status").single();
  const row = data ?? {};
  return {
    weeklyUsed: row.weekly_used ?? 0,
    weeklyLimit: row.weekly_limit ?? 3,
    resetsAt: row.resets_at ?? null,
    topUpBalance: row.top_up_balance ?? 0,
  };
}

export type CreateResult =
  | { id: string }
  | { error: string; quotaExceeded?: boolean; resetsAt?: string | null };

export async function createInvestigation(
  client: Client,
  submission: SubmissionInput,
): Promise<CreateResult> {
  const { data, error } = await client
    .from("investigations")
    .insert({ submission: { ...submission, job_text: submission.job_text ?? "" } })
    .select("id")
    .single();
  if (error || !data) {
    // Idempotent dedup: the trigger raises SQLSTATE PT409 with hint=<existing
    // id> when this user re-submits an identical job inside the dedup window.
    // Treat it as success — hand back the existing id so the caller redirects
    // there (no new row, no quota spent). Match on code first, message as
    // fallback, and only if the hint actually carries an id.
    if ((error?.code === "PT409" || error?.message === "duplicate_submission") && error?.hint) {
      return { id: error.hint };
    }
    // Over-quota surfaces as SQLSTATE PT429 (HTTP 429). Match on code first,
    // fall back to the message so UX survives a PostgREST mapping change.
    if (error?.code === "PT429" || error?.message === "check_quota_exceeded") {
      return { error: "check_quota_exceeded", quotaExceeded: true, resetsAt: error?.hint ?? null };
    }
    return { error: error?.message ?? "Could not start the check." };
  }
  return { id: (data as { id: string }).id };
}

export async function getInvestigation(
  client: Client,
  id: string,
): Promise<{ investigation: Investigation; steps: InvestigationStep[] } | null> {
  const { data: inv } = await client.from("investigations").select("*").eq("id", id).single();
  if (!inv) return null;
  const { data: steps } = await client
    .from("investigation_steps")
    .select("*")
    .eq("investigation_id", id)
    .order("display_order", { ascending: true });
  return {
    investigation: inv as unknown as Investigation,
    steps: (steps ?? []) as unknown as InvestigationStep[],
  };
}

export async function recentInvestigations(client: Client, limit = 5): Promise<Investigation[]> {
  const { data } = await client
    .from("investigations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as Investigation[];
}

// ---------------------------------------------------------------------------
// Landing-page stats (the "So far" rail). Aggregates over every completed
// investigation, read through the anon-executable `public_stats()` RPC — RLS
// scopes `investigations` to its owner, so a plain select can never produce a
// cross-user total. Nothing here is per-user or per-row.
// ---------------------------------------------------------------------------

export type PublicStats = {
  postingsChecked: number | null;
  // null when there is nothing to average over yet (no findings / no completed
  // runs). The rail renders those as an em dash rather than a misleading 0.
  findingsWithSourcesPct: number | null;
  medianSeconds: number | null;
};

const NO_STATS: PublicStats = {
  postingsChecked: null,
  findingsWithSourcesPct: null,
  medianSeconds: null,
};

export async function publicStats(client: Client): Promise<PublicStats> {
  // `public_stats` is a DB RPC not present in the hand-authored Database types;
  // cast narrowly (same pattern as quotaStatus above).
  const { data, error } = await (client.rpc as unknown as (fn: string) => {
    single: () => Promise<{
      data: {
        postings_checked?: number | null;
        findings_with_sources_pct?: number | null;
        median_seconds?: number | null;
      } | null;
      error: unknown;
    }>;
  })("public_stats").single();
  // A failed fetch is indistinguishable from "no data yet" for the reader's
  // purposes, and both must render the placeholder — never a fabricated zero.
  if (error || !data) return NO_STATS;
  return {
    postingsChecked: data.postings_checked ?? null,
    findingsWithSourcesPct: data.findings_with_sources_pct ?? null,
    medianSeconds: data.median_seconds ?? null,
  };
}
