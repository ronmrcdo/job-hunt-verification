import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Cheap first cut for /admin/*: a request with no CF Access assertion never
  // reaches the route. Full JWKS verification lives in lib/admin/access.ts.
  // 404, never 403 — no existence leak (app-wide convention). This holds even
  // if a request reaches the Traefik origin around Cloudflare.
  const pathname = request.nextUrl.pathname;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!request.headers.get("cf-access-jwt-assertion")) {
      // Render the app's branded 404 (app/not-found.tsx) rather than a bare
      // body-less response the browser dresses with its own error chrome.
      // Rewriting to Next's internal /_not-found route surfaces that page with
      // its prerendered 404 status — same non-existence guarantee (indistinguishable
      // from any missing route, 404 never 403), just the styled page. Still
      // short-circuits before the route and updateSession, so no admin work runs.
      return NextResponse.rewrite(new URL("/_not-found", request.url));
    }
  }
  return updateSession(request);
}

// Run on everything except static assets and images. (The GoTrue auth email
// templates used to be excluded here too; they are served by their own Caddy
// container now — see infra/email-templates — so this app no longer touches them.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
