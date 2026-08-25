import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

// L1: only these hosts may drive the post-login redirect. Everything else falls
// back to the request origin, so a spoofed x-forwarded-host cannot bounce a
// just-authenticated user off-site.
function allowedHosts(): string[] {
  return (process.env.APP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // L2: surface a failed/expired/tampered exchange instead of dropping the
      // user on a protected route.
      return NextResponse.redirect(`${origin}/sign-in?error=auth`);
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const base =
    forwardedHost && allowedHosts().includes(forwardedHost)
      ? `${forwardedProto}://${forwardedHost}`
      : origin;
  return NextResponse.redirect(`${base}/verify`);
}
