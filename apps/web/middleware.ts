import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Run on everything except static assets and images. (The GoTrue auth email
// templates used to be excluded here too; they are served by their own Caddy
// container now — see infra/email-templates — so this app no longer touches them.)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
