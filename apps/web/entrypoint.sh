#!/bin/sh
set -e

# Run database migrations if DATABASE_URL is provided.
# The Supabase project (config.toml + migrations) is NOT baked into this image;
# it is bind-mounted at /app/supabase in docker-compose.prod.yml, so the CLI
# resolves supabase/migrations relative to the CWD (/app). `db push` only needs
# a connection string — no Docker-backed commands are involved here.
if [ -n "$DATABASE_URL" ]; then
  # Disable SSL: DATABASE_URL points at Supabase over the internal Docker
  # network, which terminates TLS at the edge, not on the Postgres socket.
  export PGSSLMODE=disable

  echo "==> Running database migrations..."
  # CLI is installed to /usr/local/bin at image-build time (see apps/web/Dockerfile).
  supabase db push --db-url "$DATABASE_URL" --include-all
  echo "==> Migrations complete."

else
  echo "==> DATABASE_URL not set, skipping migrations."
fi

# Start the Next.js standalone server (output: "standalone" emits /app/server.js).
exec node server.js
