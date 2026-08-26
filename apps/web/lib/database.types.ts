// Supabase table types — HAND-AUTHORED to match:
//   supabase/migrations/20260819073420_investigations_v1.sql
//   supabase/migrations/20260819080000_investigations_sources.sql
//   supabase/migrations/20260821000000_investigations_title.sql
//   supabase/migrations/20260822000000_investigations_entities.sql
//   supabase/migrations/20260826010000_feedback.sql
//   supabase/migrations/20260826010100_eval_candidate.sql
// OPERATOR: regenerate against the local stack and overwrite this file:
//   supabase gen types typescript --local > apps/web/lib/database.types.ts
// The jsonb payload shapes mirror apps/api/src/app/graph/state.py.

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      investigations: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          title: string | null;
          entities: Json | null;
          submission: Json;
          assessment: Json | null;
          findings: Json | null;
          sources: Json | null;
          cost: Json | null;
          what_to_verify: Json | null;
          check_count: number | null;
          created_at: string;
        };
        Insert: { submission: Json };
        Update: Record<string, never>;
        Relationships: [];
      };
      investigation_steps: {
        Row: {
          investigation_id: string;
          step_key: string;
          label: string;
          display_order: number;
          status: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      feedback: {
        Row: {
          id: string;
          investigation_id: string;
          user_id: string;
          verdict: "agree" | "too_high" | "too_low";
          wrong_finding_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          investigation_id: string;
          verdict: "agree" | "too_high" | "too_low";
          wrong_finding_id?: string | null;
          note?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      eval_candidate: {
        Row: {
          id: string;
          investigation_id: string;
          submission_snapshot: Json;
          expected_max_band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
          expected_band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | null;
          tags: string[];
          status: "promoted" | "exported";
          promoted_by: string;
          created_at: string;
          exported_at: string | null;
        };
        Insert: {
          investigation_id: string;
          submission_snapshot: Json;
          expected_max_band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
          expected_band?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | null;
          tags?: string[];
          promoted_by: string;
        };
        Update: { status?: "promoted" | "exported"; exported_at?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
