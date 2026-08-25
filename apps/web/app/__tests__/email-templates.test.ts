import { describe, expect, it } from "vitest";
import { GET } from "../emails/[template]/route";

const TEMPLATES = [
  "confirmation.html",
  "recovery.html",
  "magic-link.html",
  "email-change.html",
];

// The route is reached container-to-container (GoTrue -> web:3000), so an
// internal request carries the service Host and none of Traefik's x-forwarded-*.
function internalRequest(template: string, headers: Record<string, string> = {}) {
  return new Request(`http://web:3000/emails/${template}`, {
    headers: { host: "web:3000", ...headers },
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

  it.each(["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"])(
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
