# syntax=docker/dockerfile:1
# Next.js web app. Standalone (talks only to Supabase), so it builds from its
# own context with no monorepo workspace deps.
#
# Multi-stage — one Dockerfile, three purposes:
#   • target `dev`:  node_modules only, runs `pnpm dev` (Fast Refresh).
#     docker-compose.yml selects it via `build.target: dev` and bind-mounts the
#     live source over /app, so this stage skips the source COPY and the
#     compile entirely.
#   • target `build`: internal — compiles the app. Not run directly.
#   • target `prod` (default): the shippable image. Carries ONLY the traced
#     standalone server + static assets — no pnpm, no devDependencies, no
#     source tree. Runs as the unprivileged `node` user and declares no EXPOSE.
# With no --target, the last stage (`prod`) wins, so bare `docker build` still
# yields the shippable image.

FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── deps: install node_modules once; shared by dev and build. No per-app
# lockfile (the frozen pnpm-lock.yaml lives at the monorepo root), so resolve
# from package.json. --prod=false keeps devDependencies (Tailwind/PostCSS + the
# Next toolchain) that BOTH the dev server and `pnpm build` need.
FROM base AS deps
RUN corepack enable
COPY package.json ./
RUN pnpm install --no-frozen-lockfile --prod=false

# ── dev: no source COPY, no build. compose mounts the live source in and the
# anonymous /app/node_modules volume is seeded from this layer. Fast to build.
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "dev"]

# ── build: bake the source and compile. NEXT_PUBLIC_* are inlined into the
# client bundle at BUILD time, so the (non-secret) Supabase config must be
# present as build args here — passing them only at runtime silently ships a
# bundle pointing at the wrong Supabase project.
FROM deps AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NODE_ENV=production
COPY . .
RUN pnpm build

# ── prod: runtime only. `output: "standalone"` (next.config.js) emits a
# self-contained server.js + the traced subset of node_modules under
# .next/standalone; .next/static is NOT traced into it and must be copied
# alongside. There is no `public/` dir in this app — add a COPY for it here if
# one is ever introduced, or its assets 404. (The GoTrue auth email templates
# are served by their own Caddy container now, not this app — see
# infra/email-templates and docker-compose.prod.yml.)
FROM base AS prod
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
# Deliberately no EXPOSE: nothing publishes this port in production. Traefik
# reaches the container over the shared network and is told the port outright
# (traefik.http.services.jhv-web.loadbalancer.server.port in
# docker-compose.prod.yml) — keep that label in sync with PORT above.
# node:22-slim ships no curl/wget, so probe with node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
