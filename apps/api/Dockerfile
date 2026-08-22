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

# 1) Dependency layer — cached until pyproject.toml / uv.lock change.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# 2) Source + editable install of the `app` package itself.
COPY src ./src
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# 3) Supabase CLI, for applying migrations from inside the stack:
#     docker compose exec api-worker \
#       supabase db push --workdir /workspace --db-url "$DATABASE_URL"
# The project (supabase/config.toml + supabase/migrations) lives at the REPO
# ROOT, outside this build context, so it is NOT baked in — compose bind-mounts
# it at /workspace. `db push`/`migration up` only need a connection string; the
# Docker-backed commands (`start`, `db reset`, `db diff`) will not work here.
COPY --from=supabase-cli /usr/local/bin/supabase /usr/local/bin/supabase

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
EXPOSE 8000
CMD ["uvicorn", "app.worker.app:app", "--host", "0.0.0.0", "--port", "8000"]
