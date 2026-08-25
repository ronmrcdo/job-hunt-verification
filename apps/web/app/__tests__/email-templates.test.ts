import { describe, expect, it } from "vitest";
import { GET } from "../emails/[template]/route";

const TEMPLATES = [
  "confirmation.html",
  "recovery.html",
  "magic-link.html",
  "email-change.html",
];

// The route is reached container-to-container (GoTrue -> web:3000), so an
// internal request carries the service Host.
//
// It ALSO carries x-forwarded-host/port/proto/for: Next's own server fills those
// in on every request before a route handler sees them, whether or not a proxy
// was involved (next/dist/server/base-server.js, "Update the `x-forwarded-*`
// headers"). Any internal-only check keyed on their mere presence therefore
// rejects everything — so the fixture must reproduce them.
const NEXT_SYNTHESIZED = {
  "x-forwarded-host": "web:3000",
  "x-forwarded-port": "3000",
  "x-forwarded-proto": "http",
  "x-forwarded-for": "10.0.1.7",
};

function internalRequest(template: string, headers: Record<string, string> = {}) {
  return new Request(`http://web:3000/emails/${template}`, {
    headers: { host: "web:3000", ...NEXT_SYNTHESIZED, ...headers },
  });
}

function call(template: string, request: Request) {
  return GET(request, { params: Promise.resolve({ template }) });
}

describe("GET /emails/[template]", () => {
  it.each(TEMPLATES)("serves %s verbatim to an internal caller", async (template) => {
    const response = await call(template, internalRequest(template));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    // GoTrue renders these itself — the placeholders must survive untouched.
    expect(await response.text()).toContain("{{ .ConfirmationURL }}");
  });

  it("does not cache, so a template edit needs no web redeploy", async () => {
    const response = await call("confirmation.html", internalRequest("confirmation.html"));

    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  // Only headers Traefik sets and Next never fabricates can mark a request as
  // proxied. Traefik overwrites x-forwarded-server with its own hostname on
  // every request and strips every client-supplied X-Forwarded-*/X-Real-Ip from
  // untrusted remotes first, so neither can be spoofed from outside
  // (traefik/pkg/middlewares/forwardedheaders/forwarded_header.go, rewrite()).
  it.each(["x-forwarded-server", "x-real-ip"])(
    "404s a request proxied through Traefik (%s present)",
    async (header) => {
      const response = await call(
        "confirmation.html",
        internalRequest("confirmation.html", { [header]: "203.0.113.7" }),
      );

      expect(response.status).toBe(404);
    },
  );

  it("404s a request for the public host", async () => {
    const response = await call(
      "confirmation.html",
      new Request("https://jobverifai.ronmrcdo.dev/emails/confirmation.html", {
        headers: { host: "jobverifai.ronmrcdo.dev" },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("404s a request with no Host header", async () => {
    const response = await call("confirmation.html", new Request("http://web:3000/emails/confirmation.html"));

    expect(response.status).toBe(404);
  });

  it.each(["../middleware.ts", "../../package.json", "unknown.html", "_base-notes.md"])(
    "404s the non-template name %s without touching the filesystem",
    async (template) => {
      const response = await call(template, internalRequest(template));

      expect(response.status).toBe(404);
    },
  );
});
