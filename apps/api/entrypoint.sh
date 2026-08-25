#!/bin/sh
set -e

# Apply database migrations before the app boots — opt-in via RUN_MIGRATIONS so
# ONLY the prod api-worker migrates (set in docker-compose.prod.yml). The dev
# stack leaves it unset and manages its local DB with the Supabase CLI on the
# host, so `docker compose up` stays side-effect free.
if [ "$RUN_MIGRATIONS" = "1" ]; then
  if [ -z "$DATABASE_URL" ]; then
    echo "==> RUN_MIGRATIONS=1 but DATABASE_URL is unset — cannot migrate." >&2
    exit 1
  fi

  # Supabase over the internal Docker network terminates TLS at the edge, not on
  # the Postgres socket, so disable libpq SSL negotiation for the push. This is
  # safe ONLY because DATABASE_URL here reaches Postgres over the internal
  # `coolify` Docker network (container-to-container), never the public
  # internet — the traffic is not TLS-protected on the wire. If the DB is ever
  # reached over a non-local path (a managed/hosted Postgres outside this
  # Docker network, a public endpoint, a different host), this MUST be
  # revisited to `PGSSLMODE=require` (or stronger) before that change ships.
  export PGSSLMODE=disable

  echo "==> Running database migrations..."
  # The CLI and the project (config.toml + migrations) are baked into this image
  # at /app/supabase (see apps/api/Dockerfile); --workdir points the CLI there.
  supabase db push --workdir /app --db-url "$DATABASE_URL" --include-all
  echo "==> Migrations complete."
fi

# Hand off to the service command (uvicorn worker/http, per compose `command:`).
exec "$@"
