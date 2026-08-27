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
// Kong's key-auth only recognizes the anon/service keys, so it rejects the
// custom admin_ro JWT with "No API key found"/"Invalid authentication" before
// the request reaches PostgREST. We clear that by sending the (already public)
// anon key as the `apikey` header — Kong's gatekeeper — while the admin_ro JWT
// still rides in `Authorization: Bearer` (supabase-js's default from the key
// arg below), so PostgREST SET ROLEs into admin_ro. No privilege is added: the
// anon key is public; the privilege lives entirely in the secret Bearer JWT.
//
// This keeps Kong, which is the ONLY layer that routes the `/rest/v1` prefix
// supabase-js unconditionally appends (SupabaseClient builds `new URL('rest/v1',
// baseUrl)`). Do NOT point SUPABASE_ADMIN_URL at bare PostgREST to "bypass Kong":
// PostgREST serves tables at root, so `/rest/v1/investigations` is a 3-segment
// path it rejects with "Invalid path specified in request URL" — every admin
// read then fails (Overview cards read 0; the feedback queue shows that error).
//
// SUPABASE_ADMIN_URL remains an optional override for a gateway on a different
// host, but it must still front PostgREST with the `/rest/v1` prefix. Falls back
// to the public URL.
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
      {
        auth: { persistSession: false, autoRefreshToken: false },
        // apikey satisfies Kong's key-auth; the admin_ro JWT stays the Bearer
        // token (default from the key arg above) so PostgREST picks up the role.
        global: { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } },
      },
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
