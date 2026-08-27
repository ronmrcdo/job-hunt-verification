import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin client authenticates as the least-privilege `admin_ro` role, whose
// custom JWT the self-hosted Kong gateway's key-auth does NOT recognize. The
// client must therefore send the (public) anon key as the `apikey` header so
// Kong lets the request through, while the admin_ro JWT rides in
// `Authorization: Bearer` (supabase-js's default from the key arg) so PostgREST
// SET ROLEs into admin_ro. This keeps Kong — which is the only layer that routes
// the `/rest/v1` prefix supabase-js always appends; pointing straight at bare
// PostgREST makes every request a 3-segment path it rejects with
// "Invalid path specified in request URL".
const createClient = vi.fn(() => ({ from: () => ({}) }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("server-only", () => ({}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-123",
  SUPABASE_ADMIN_KEY: "admin-ro-jwt-456",
};

beforeEach(() => {
  createClient.mockClear();
  vi.resetModules();
  Object.assign(process.env, ENV);
  delete process.env.SUPABASE_ADMIN_URL;
});

afterEach(() => {
  for (const k of Object.keys(ENV)) delete (process.env as Record<string, string | undefined>)[k];
});

describe("supabaseAdmin", () => {
  it("sends the anon key as the apikey header so Kong's key-auth passes", async () => {
    const { supabaseAdmin } = await import("../admin");
    // Proxy defers construction to first property access.
    void supabaseAdmin.from;

    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClient.mock.calls[0] as unknown as [string, string, any];
    expect(url).toBe(ENV.NEXT_PUBLIC_SUPABASE_URL); // Kong gateway, not bare PostgREST
    expect(key).toBe(ENV.SUPABASE_ADMIN_KEY); // admin_ro JWT → Authorization: Bearer
    expect(options.global.headers.apikey).toBe(ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });
});
