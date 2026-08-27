import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
//
// Constructed LAZILY, on first use. SUPABASE_ADMIN_KEY is a runtime-only secret
// and is deliberately NOT a build arg (apps/web/Dockerfile), so it's absent
// during `next build`. Building the client at module top-level would then throw
// "supabaseKey is required" while Next collects page data for /admin/*, failing
// the build. Deferring construction keeps import side-effect-free: the key is
// read only when a request actually reaches an /admin route at runtime.
let client: SupabaseClient<Database> | null = null;
function getClient(): SupabaseClient<Database> {
  if (!client) {
    client = createClient<Database>(
      process.env.SUPABASE_ADMIN_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_ADMIN_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}

// A thin proxy so callers keep the ergonomic `supabaseAdmin.from(...)` surface
// while construction stays deferred to the first property access.
export const supabaseAdmin: SupabaseClient<Database> = new Proxy(
  {} as SupabaseClient<Database>,
  {
    get(_target, prop, receiver) {
      const c = getClient();
      const value = Reflect.get(c, prop, receiver);
      return typeof value === "function" ? value.bind(c) : value;
    },
  },
);
