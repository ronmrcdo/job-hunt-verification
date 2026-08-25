/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone — a self-contained server.js plus only the
  // node_modules the build actually traced. The production Docker stage ships
  // that instead of the full dev+prod node_modules tree. No effect on
  // `next dev`; `next build` just writes an extra .next/standalone directory.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // Report pages render only first-party assets + Supabase (auth,
            // realtime websocket). 'unsafe-inline' is required in script-src
            // because Next.js App Router injects inline bootstrap/hydration
            // scripts (and no 'nonce'/'strict-dynamic' is wired — that needs a
            // per-request nonce set in middleware, which forces dynamic
            // rendering; see the CSP note in docs). The high-value protections
            // (frame-ancestors, HSTS, nosniff, referrer) are unaffected by this.
            // connect-src uses a wildcard https/wss; pin it to
            // NEXT_PUBLIC_SUPABASE_URL if you prefer a stricter policy.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              // 'unsafe-inline': Next's inline bootstrap scripts (see above).
              // Cloudflare Turnstile loads api.js + renders its challenge iframe
              // from challenges.cloudflare.com (auth captcha).
              "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
              "frame-src https://challenges.cloudflare.com",
              "connect-src 'self' https: wss:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
