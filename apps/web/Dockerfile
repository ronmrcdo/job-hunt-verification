# syntax=docker/dockerfile:1
# Next.js web app. Standalone (talks only to Supabase), so it builds from its
# own context with no monorepo workspace deps.
#
# Multi-stage — one Dockerfile, two purposes:
#   • target `prod` (default): compiled production build → `pnpm start`.
#   • target `dev`: node_modules only, runs `pnpm dev` (Fast Refresh). compose
#     selects it via `build.target: dev` and bind-mounts the live source over
#     /app, so this stage skips the source COPY and the prod compile entirely.
# With no --target, the last stage (`prod`) wins, so bare `docker build` still
# yields the shippable image.

FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1

# ── deps: install node_modules once; shared by dev and prod. No per-app
# lockfile (the frozen pnpm-lock.yaml lives at the monorepo root), so resolve
# from package.json. --prod=false keeps devDependencies (Tailwind/PostCSS + the
# Next toolchain) that BOTH the dev server and `pnpm build` need.
FROM base AS deps
COPY package.json ./
RUN pnpm install --no-frozen-lockfile --prod=false

# ── dev: no source COPY, no build. compose mounts the live source in and the
# anonymous /app/node_modules volume is seeded from this layer. Fast to build.
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "dev"]

# ── prod: bake the source and compile. NEXT_PUBLIC_* are inlined into the
# client bundle at BUILD time, so the (non-secret, local) Supabase config must
# be present as build args here.
FROM deps AS prod
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NODE_ENV=production
COPY . .
RUN pnpm build
# Drop to the unprivileged `node` user (baked into the node image) for the
# shippable image — nothing at runtime needs root. dev stays root so the
# bind-mounted source and seeded node_modules volume stay writable.
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
