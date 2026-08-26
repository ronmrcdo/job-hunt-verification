import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

// CF Access verification for /admin/*. Cloudflare Access puts a signed JWT in
// the Cf-Access-Jwt-Assertion header once a request clears the email allowlist.
// We DO NOT trust it blindly (spec Global Constraints): verify it against the
// team's JWKS + audience before doing anything. A missing/invalid assertion is
// an AdminAccessError, which every /admin/* surface maps to 404 — never 403, so
// the route's existence never leaks even if a request reaches the origin around
// Cloudflare. Admin identity lives ONLY in CF Access; the app holds no is_admin
// column and no roles table.
export class AdminAccessError extends Error {}

// Module-level singleton so the JWKS is fetched+cached once per server process,
// not per request. Keyed off the team domain; jose handles the cache + rotation.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  const team = process.env.CF_ACCESS_TEAM_DOMAIN;
  if (!team) throw new AdminAccessError("CF_ACCESS_TEAM_DOMAIN unset");
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
  }
  return jwks;
}

export async function resolveAdminEmail(headers: Headers): Promise<string> {
  const assertion = headers.get("cf-access-jwt-assertion");
  if (!assertion) throw new AdminAccessError("missing Cf-Access-Jwt-Assertion");

  const aud = process.env.CF_ACCESS_AUD;
  if (!aud) throw new AdminAccessError("CF_ACCESS_AUD unset");

  let email: unknown;
  try {
    const { payload } = await jwtVerify(assertion, getJwks(), {
      issuer: `https://${process.env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: aud,
    });
    email = payload.email;
  } catch (e) {
    throw new AdminAccessError(`invalid assertion: ${(e as Error).message}`);
  }

  if (typeof email !== "string" || !email) {
    throw new AdminAccessError("verified assertion carried no email");
  }
  return email;
}

// Alias used by /admin/* route handlers and server actions; identical behavior.
export const assertAdmin = resolveAdminEmail;
