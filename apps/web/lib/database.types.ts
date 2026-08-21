// Supabase table types — HAND-AUTHORED to match:
//   supabase/migrations/20260819073420_investigations_v1.sql
//   supabase/migrations/20260819080000_investigations_sources.sql
//   supabase/migrations/20260821000000_investigations_title.sql
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
