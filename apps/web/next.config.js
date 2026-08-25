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
            // realtime websocket). No inline-eval; keep 'unsafe-inline' only
            // for styles until nonces are wired. connect-src must allow the
            // Supabase origin — this template uses a wildcard https/wss; pin it
            // to NEXT_PUBLIC_SUPABASE_URL if you prefer a stricter policy.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self'",
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
