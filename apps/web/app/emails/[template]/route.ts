import { readFile } from "node:fs/promises";
import path from "node:path";

// GoTrue fetches these over plain HTTP at send time and renders the
// `{{ .Variable }}` placeholders itself, so they are served verbatim — never
// through Next's renderer. They used to live in `public/`, which made them
// readable by anyone on the public domain; they are internal-only now.
export const dynamic = "force-dynamic";

// Literal allow-list, not a sanitised path: a request can only ever name one of
// these four files, so no traversal reaches the filesystem.
const TEMPLATES = new Set([
  "confirmation.html",
  "recovery.html",
  "magic-link.html",
  "email-change.html",
]);

// Hosts GoTrue may reach this route on. `web:3000` is the compose service alias
// on the shared `coolify` network; loopback covers `next dev` and the container
// healthcheck. Same env-allow-list pattern as APP_ALLOWED_HOSTS in
// app/auth/callback/route.ts.
const DEFAULT_ALLOWED_HOSTS = "web:3000,127.0.0.1:3000,localhost:3000";

// Traefik sets both on anything it forwards, so their presence means the request
// came in off the public domain. They also cannot be spoofed from outside:
// x-forwarded-server is overwritten with Traefik's own hostname on every request,
// and every client-supplied X-Forwarded-*/X-Real-Ip is stripped first unless the
// remote is a configured trusted IP (traefik/pkg/middlewares/forwardedheaders/
// forwarded_header.go, ServeHTTP + rewrite).
//
// Deliberately NOT x-forwarded-host/port/proto/for: Next's server fills those in
// itself on every request, proxied or not (next/dist/server/base-server.js,
// "Update the `x-forwarded-*` headers"), so testing for them rejects the internal
// callers too and the route 404s everything.
const PROXY_HEADERS = ["x-forwarded-server", "x-real-ip"];

function isInternal(request: Request): boolean {
  if (PROXY_HEADERS.some((header) => request.headers.has(header))) return false;

  const allowed = (process.env.EMAIL_TEMPLATE_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS)
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const host = request.headers.get("host");
  return host !== null && allowed.includes(host);
}

// Every rejection is a 404, never a 403: the public domain should not confirm
// that these templates exist at all.
const notFound = () => new Response("Not Found", { status: 404 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ template: string }> },
) {
  const { template } = await params;
  if (!TEMPLATES.has(template) || !isInternal(request)) return notFound();

  const html = await readFile(path.join(process.cwd(), "emails", template), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // GoTrue caches templates itself (GOTRUE_MAILER_TEMPLATE_MAX_AGE), so an
      // edit only needs the auth container's cache to lapse — not a web rebuild.
      "cache-control": "no-store",
    },
  });
}
