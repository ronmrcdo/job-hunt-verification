import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  // Behind a reverse proxy (Traefik in prod) request.url's origin is the
  // container's internal bind address (http://0.0.0.0:3000), so redirecting to
  // `${origin}/verify` sends the browser to a dead address. Prefer the public
  // origin the proxy forwards; fall back to request.url when running direct.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const base = forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin;
  return NextResponse.redirect(`${base}/verify`);
}
