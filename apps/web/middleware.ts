import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Run on everything except static assets, images, and the public auth email
// templates under /emails (GoTrue fetches those over HTTP; middleware must not
// intercept and redirect them to a login page).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|emails/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
