import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Run on everything except static assets, images, and the auth email templates
// under /emails. GoTrue fetches those over HTTP with no session; middleware must
// not intercept and redirect them to a login page. They are not left open by
// this exclusion — app/emails/[template]/route.ts serves them only to callers on
// the internal Docker network.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|emails/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
