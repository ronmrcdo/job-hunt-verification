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
export type Investigation = {
  id: string;
  user_id: string;
  status: string;
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

export async function createInvestigation(
  client: Client,
  submission: SubmissionInput,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await client
    .from("investigations")
    .insert({ submission })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not start the check." };
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
