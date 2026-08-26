import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

// Privileged, server-only Supabase client for /admin/* (feedback triage +
// eval-candidate promotion). It authenticates as the least-privilege `admin_ro`
// role (see supabase/migrations/20260826130000_admin_ro_role.sql): bypasses RLS
// for cross-user reads, but can only SELECT feedback/investigations and INSERT
// eval_candidate — no delete/update, no other tables. A leak of
// SUPABASE_ADMIN_KEY therefore cannot wipe or exfiltrate the database the way a
// leaked service_role key could.
//
// `import "server-only"` makes the build FAIL if a client component ever imports
// this module, so the key can never reach the browser bundle. SUPABASE_ADMIN_KEY
// is not NEXT_PUBLIC_*, so it stays server-side. This module is the sole reader
// of it.
//
// SUPABASE_ADMIN_URL is an optional override: point it at PostgREST directly
// (bypassing the self-hosted Kong gateway) if Kong rejects the custom JWT with
// "No API key found"/"Invalid authentication". Falls back to the public URL.
export const supabaseAdmin = createClient<Database>(
  process.env.SUPABASE_ADMIN_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ADMIN_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
