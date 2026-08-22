# syntax=docker/dockerfile:1
# Python API image — serves BOTH ASGI apps in this package:
#   • app.worker.app:app  → Inngest serve endpoint (/api/inngest)  [api-worker]
#   • app.main:app        → V0 synchronous HTTP API               [api-http]
# The command is chosen per service in docker-compose.yml /
# docker-compose.prod.yml. The same image is used for dev and production; only
# the command, the env, and the absence of a source bind-mount differ.
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

# 3) Drop root. Everything under /app is installed by now and only needs to be
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
