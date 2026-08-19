# syntax=docker/dockerfile:1
# Next.js web app. Standalone (talks only to Supabase), so it builds from its
# own context with no monorepo workspace deps.
FROM node:22-slim
WORKDIR /app
RUN corepack enable

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so the
# (non-secret, local) Supabase config must be present as build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

COPY package.json ./
# No per-app lockfile (the frozen pnpm-lock.yaml lives at the monorepo root);
# resolve from package.json here.
RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 3000
CMD ["pnpm", "start"]
