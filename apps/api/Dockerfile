# syntax=docker/dockerfile:1
# Python API image — serves BOTH ASGI apps in this package:
#   • app.worker.app:app  → Inngest serve endpoint (/api/inngest)  [api-worker]
#   • app.main:app        → V0 synchronous HTTP API               [api-http]
# The command is chosen per service in docker-compose.yml /
# docker-compose.prod.yml. The same image is used for dev and production; only
# the command, the env, and the absence of a source bind-mount differ.

# ── supabase-cli: throwaway fetch stage. The CLI is a single static binary, but
# downloading it needs curl, which python:3.12-slim does not ship — grabbing it
# here keeps curl (and apt's lists) out of the runtime image; only the ~39 MB
# binary is copied across. TARGETARCH is a BuildKit predefined arg and must be
# re-declared per stage to be visible.
FROM python:3.12-slim AS supabase-cli
ARG SUPABASE_CLI_VERSION=2.115.0
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) SUPABASE_ARCH=amd64 ;; \
      arm64) SUPABASE_ARCH=arm64 ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/supabase.tar.gz \
      "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_${SUPABASE_ARCH}.tar.gz"; \
    tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin supabase; \
    rm /tmp/supabase.tar.gz; \
    supabase --version

FROM python:3.12-slim

# uv gives us fast, fully-locked installs straight from uv.lock.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# The build context is the repo ROOT (compose sets `context: .`) so we can reach
# both this package (apps/api) and the Supabase project (supabase/) below. See
# the root .dockerignore, which trims the context back down to just those two.

# 1) Dependency layer — cached until pyproject.toml / uv.lock change.
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# 2) Source + editable install of the `app` package itself.
COPY apps/api/src ./src
COPY apps/api/scripts ./scripts
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# 3) Supabase CLI + project, for applying migrations from inside the stack:
#     docker compose exec api-worker \
#       supabase db push --workdir /app --db-url "$DATABASE_URL"
# Because the context is the repo root, the project (supabase/config.toml +
# supabase/migrations + supabase/functions) is baked in at /app/supabase — no
# bind-mount needed. `db push`/`migration up` only need a connection string; the
# Docker-backed commands (`start`, `db reset`, `db diff`) will not work here.
COPY --from=supabase-cli /usr/local/bin/supabase /usr/local/bin/supabase
COPY supabase ./supabase

# entrypoint.sh runs `supabase db push` before the service command when
# RUN_MIGRATIONS=1 (prod api-worker only), then execs "$@". Everything it needs
# — CLI + project — is baked in above, so no bind-mount or network context.
COPY --chmod=0755 apps/api/entrypoint.sh /app/entrypoint.sh

# 4) Drop root. Everything under /app is installed by now and only needs to be
# readable at runtime, so the app user owns nothing and can write nowhere —
# which is what we want in production. In dev the bind-mounted source is only
# ever read (uvicorn --reload watches it), so this is safe there too.
RUN useradd --create-home --uid 10001 appuser
USER appuser

# No image-level HEALTHCHECK on purpose: the two entrypoints don't share a
# health surface (app.worker.app serves GET /healthz, app.main does not), so
# the probe belongs on the individual compose service. See the api-worker
# healthcheck in docker-compose.prod.yml.

# Default = the Inngest worker; compose overrides for the V0 HTTP API.
#
# Deliberately no EXPOSE: it would be a lie half the time — this image serves
# two entrypoints on two different ports (worker :8000, app.main :8080), and
# nothing reads the metadata anyway. Dev publishes ports explicitly in
# docker-compose.yml; production publishes none and tells Traefik the port
# outright (traefik.http.services.jhv-worker.loadbalancer.server.port).
#
# ENTRYPOINT wraps the command with the migration step; CMD is the default it
# execs (compose overrides it per service).
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.worker.app:app", "--host", "0.0.0.0", "--port", "8000"]
