// Mint the `admin_ro` API key for the server-only Supabase admin client.
//
// A Supabase "key" is just a JWT signed with the project's JWT_SECRET carrying
// a `role` claim (the anon/service_role keys are exactly this). This mints one
// whose role is the least-privilege `admin_ro` Postgres role created in
// supabase/migrations/20260826130000_admin_ro_role.sql.
//
// Run ONCE, locally/offline, with the real secret. Paste the printed token into
// the WEB app's Coolify env as SUPABASE_ADMIN_KEY (NOT NEXT_PUBLIC_*). Never
// commit the secret or the output.
//
//   JWT_SECRET='<supabase stack JWT_SECRET>' node apps/web/scripts/mint-admin-key.mjs
//
// Zero dependencies — HS256 is HMAC-SHA256 over base64url(header).base64url(payload).

import { createHmac } from "node:crypto";

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error(
    "Set JWT_SECRET to your Supabase stack's signing secret (the same secret " +
      "that signs your anon/service_role keys), e.g.:\n" +
      "  JWT_SECRET='...' node apps/web/scripts/mint-admin-key.mjs",
  );
  process.exit(1);
}

const b64url = (input) => Buffer.from(input).toString("base64url");

const now = Math.floor(Date.now() / 1000);
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

const header = { alg: "HS256", typ: "JWT" };
const payload = {
  role: "admin_ro",
  iss: "supabase",
  iat: now,
  exp: now + TEN_YEARS, // long-lived, like the anon/service_role keys
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");

console.log(`${signingInput}.${signature}`);
