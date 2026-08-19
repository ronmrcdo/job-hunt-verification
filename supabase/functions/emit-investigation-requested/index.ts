/**
 * Supabase Edge Function: emit-investigation-requested
 *
 * Deployment Environment Configuration
 *
 * Required secrets (set per environment):
 * - INNGEST_EVENT_URL: The base URL of the Inngest event ingestion endpoint
 * - INNGEST_EVENT_KEY: The API key for authenticating with Inngest
 *
 * To deploy, set these secrets in each environment:
 *
 *   supabase secrets set INNGEST_EVENT_URL=<value> INNGEST_EVENT_KEY=<value>
 *
 * Environment-specific values:
 * - Development: INNGEST_EVENT_URL typically points to the local Inngest Dev Server
 * - Production: INNGEST_EVENT_URL points to the self-hosted or managed Inngest instance
 *
 * If either secret is missing, the function returns 500 (missing configuration).
 * If the Inngest POST fails with non-2xx status, the function returns 502 (invocation layer should retry).
 */

import { buildInngestEvent, WebhookPayload } from "./event.ts";

Deno.serve(async (req) => {
  const url = Deno.env.get("INNGEST_EVENT_URL");   // per-env: Dev Server local, self-hosted prod
  const key = Deno.env.get("INNGEST_EVENT_KEY");
  if (!url || !key) return new Response("missing inngest config", { status: 500 });

  const payload = (await req.json()) as WebhookPayload;
  const event = buildInngestEvent(payload);

  const res = await fetch(`${url}/e/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  // Non-2xx => let the invocation layer retry; the §6 sweeper is the backstop.
  return new Response(null, { status: res.ok ? 202 : 502 });
});
