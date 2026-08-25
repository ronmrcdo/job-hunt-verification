# Production Deployment & Operations

How the V1 backend runs in production: what is deployed, how a submission becomes
an investigation, every variable and where it is set, how to deploy and cut over,
where to look when a run fails, and how to roll back.

The design rationale lives in
[`docs/superpowers/specs/2026-08-24-inngest-loop-simplification-design.md`](superpowers/specs/2026-08-24-inngest-loop-simplification-design.md).
This document describes the deployed system; the spec explains why it looks this way.

---

## 1. Topology

Four units run on a single host, all attached to the shared external Docker
network named `coolify`. Coolify + Traefik front the two that need a public URL.

| Unit | What it is | Public route | Notes |
|---|---|---|---|
| **web** | Next.js image (`docker-compose.prod.yml` → `web`) | `jobverifai.ronmrcdo.dev` | Talks to Supabase directly (auth, data, Realtime). |
| **api-worker** | FastAPI + LangGraph Inngest worker | **none — internal only** | Its only inbound caller is the Inngest server. |
| **Inngest** | `inngest start` server pod | dashboard only (`jobverifai-inngest.ronmrcdo.dev`) | Deployed as its **own Coolify stack**, not in this compose file. |
| **Supabase** | Self-hosted Postgres + Auth + Realtime | its own routes | Also its **own Coolify stack**. Holds the app data and the emit trigger. |

Only **web** and the **Inngest dashboard** are reachable from the internet. The
worker has no human-facing surface — only `/healthz` (hit over loopback by the
compose healthcheck) and the machine-to-machine `/api/inngest`.

`api-worker` and `web` live in `docker-compose.prod.yml`. **Inngest and Supabase
are separate Coolify stacks** — this compose project only points at them. That
separation is the source of the one network caveat below (§3, the DB setting).

---

## 2. Dispatch chain

A submission reaches the worker in **two internal hops**, neither of which leaves
the Docker network:

```
web ──INSERT investigations──▶ Supabase Postgres
                                  │  AFTER INSERT trigger: emit_investigation_requested()
                                  │  pg_net POST  ──hop 1──▶  Inngest  http://inngest:8288/e/<event_key>
                                  │                              │
                                  │                              │ invoke ──hop 2──▶ api-worker
                                  │                              │        http://api-worker:8000/api/inngest
                                  ▼                              ▼
web ◀──Realtime: investigation_steps──  Postgres ◀──status + result──  LangGraph run
```

- **Hop 1** — the AFTER INSERT trigger builds the Inngest event in SQL
  (`build_inngest_event`) and POSTs it via `pg_net` straight to the Inngest
  server's `/e/<event_key>` ingestion endpoint. There is no Edge Function; it was
  deleted (its JSON-reshaping logic is now `build_inngest_event`, and its two
  Deno tests are ported to `apps/api/tests/sql/test_emit_event.py`).
- **Hop 2** — the Inngest server invokes the worker by POSTing to the callback URL
  the worker advertised at app-sync time (`INNGEST_SERVE_ORIGIN`).

The event `id` **equals the investigation id**. It is Inngest's idempotency key,
and `sweep_stale_queued_fn` relies on it to safely re-emit rows stuck in `queued`.

**Delivery backstop.** `pg_net` does **not** retry a failed POST. If hop 1 fails,
the row sits in `queued` and the Inngest cron **`sweep-stale-queued`** re-emits it
(and fails zombie `running` rows past their deadline). The event chain is a latency
optimization over that sweeper, not the only path.

---

## 3. Configuration

Three places hold configuration. Know which is which — restarting fixes a compose
change but not a database setting, and a rebuild is needed for build-time web vars.

### 3a. Compose environment (`.env.production`, consumed by `docker-compose.prod.yml`)

Copy `.env.production.example` → `.env.production` (gitignored) and fill in.
Every `${VAR:?...}` is enforced at `up` time — a missing one fails the deploy
loudly instead of booting a half-configured stack.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✔ | App Postgres (pooler/session URI). |
| `OPENAI_API_KEY` | ✔ | LLM provider key. |
| `TAVILY_API_KEY` | ✔ | Web-search key. |
| `INNGEST_SIGNING_KEY` | ✔ | Signs worker↔Inngest calls. **Plain even-length hex** (see gotchas). |
| `INNGEST_EVENT_KEY` | ✔ | Authenticates event sends. Must match the value in the DB setting below. |
| `INNGEST_POSTGRES_PASSWORD` | ✔ | Password for Inngest's **own** state Postgres (not the app DB). |
| `INNGEST_BASE_URL` | default `http://inngest:8288` | worker → Inngest: event sends + the `/fn/register` sync handshake. |
| `INNGEST_SERVE_ORIGIN` | default `http://api-worker:8000` | The callback URL the SDK advertises during app sync — where Inngest invokes the worker. |
| `INNGEST_BASICAUTH_USERS` | ✔ (dashboard) | htpasswd line(s) for the Inngest dashboard. **Do not double the `$`** (see gotchas). |
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ | **Build-time** — inlined into the web bundle. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | **Build-time** — inlined into the web bundle. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ✔ | **Build-time** — Cloudflare Turnstile **site** key for the auth captcha; inlined into the web bundle. Must pair with `GOTRUE_SECURITY_CAPTCHA_SECRET` on the Supabase stack (§3d), or sign-in/sign-up fails. |
| `WEB_HOST` / `INNGEST_HOST` | — | Traefik router hostnames. |
| `EMAIL_TEMPLATE_ALLOWED_HOSTS` | default `web:3000,127.0.0.1:3000,localhost:3000` | Hosts GoTrue may fetch the auth email templates on (§3e). A `Host` outside this list gets a 404. |
| model routing (`CHEAP_MODEL`, `STRONG_MODEL`, `*_REASONING_EFFORT`, `STRUCTURED_OUTPUT_*`, `OPENAI_BASE_URL`, `COST_PRICES_JSON`) | — | Compose has sane defaults; override per deployment. |

`INNGEST_BASE_URL` and `INNGEST_SERVE_ORIGIN` are read by the Inngest SDK
**straight from the environment** (`inngest/_internal/config_lib.py`), never
through `app.config.Settings`.

> **`NEXT_PUBLIC_*` are build-time.** They are compiled into the client bundle as
> build args. Changing either needs `up -d --build`, **not** a plain restart.

### 3b. Database settings (Postgres, set once per environment)

The emit trigger reads two Postgres settings — **not** compose env vars. They keep
the base URL and event key out of migration SQL, so key rotation touches one value
and never a code change:

```sql
alter database postgres set app.settings.inngest_base_url = 'http://inngest:8288';
alter database postgres set app.settings.inngest_event_key = '<INNGEST_EVENT_KEY>';
```

Two settings, never one pre-joined URL. `inngest_event_key` **must equal**
`INNGEST_EVENT_KEY` in the compose env, or Inngest rejects the event.

> **Network caveat.** `app.settings.inngest_base_url` must resolve **from inside
> the Supabase Postgres container**, which is a *separate Coolify stack* from this
> compose project. If `inngest` does not resolve from there, use the **public
> Inngest URL** (`https://jobverifai-inngest.ronmrcdo.dev`) for this setting
> instead — and keep the `/e/*` Cloudflare Access carve-out (see §5 cutover).
> This is a runtime setting; switching it is not a code change.

### 3c. Coolify UI

Coolify **injects environment set in its UI into the container**, which can shadow
the compose defaults. If a running container shows an unexpected value for any
variable above, check the Coolify UI's env settings for that service **first**.

### 3d. Signup-abuse hardening (Supabase Auth)

`supabase/config.toml` governs **only the local dev stack** (`supabase start`).
The **production self-hosted Supabase stack is configured separately in
Coolify** and must set, on the Auth (GoTrue) service:

- `GOTRUE_MAILER_AUTOCONFIRM=false` — require email confirmation before a new
  account can sign in (mirrors `[auth.email] enable_confirmations = true` in
  `config.toml`).
- A captcha provider + secret (Turnstile) — mirrors `[auth.captcha]` in
  `config.toml`. GoTrue's captcha env vars are `GOTRUE_SECURITY_CAPTCHA_ENABLED=true`,
  `GOTRUE_SECURITY_CAPTCHA_PROVIDER=turnstile`, and `GOTRUE_SECURITY_CAPTCHA_SECRET=<your Turnstile SECRET key>`.

Neither setting is read from this repo's `config.toml` in production — that
file only applies when running the Supabase CLI locally.

**Turnstile is a two-key pair — both halves must be set or auth breaks.** Create
one Turnstile widget in the Cloudflare dashboard (add the production hostname,
e.g. `jobverifai.ronmrcdo.dev`, to its allowed domains); it yields a **site
key** and a **secret key**:

| Key | Env var | Where it goes | Why |
|---|---|---|---|
| Site (public) | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | this compose stack's **web build arg** (§3a) — build-time | the browser widget renders with it and produces a token |
| Secret | `GOTRUE_SECURITY_CAPTCHA_SECRET` | the **Supabase (GoTrue) stack** in Coolify | GoTrue verifies the token against it on signup/sign-in |

With captcha enabled on GoTrue, a request **without** a valid token is rejected —
so the web bundle must carry a working site key. The frontend widget lives in
`apps/web/components/auth/AuthForm.tsx` and passes the token via
`options.captchaToken`; changing `NEXT_PUBLIC_TURNSTILE_SITE_KEY` needs
`up -d --build` (it is baked into the bundle). For local dev, use Cloudflare's
always-pass **test** keys (site `1x00000000000000000000AA`, secret
`1x0000000000000000000000000000000AA`) — see `apps/web/.env.example` and
`scripts/RUNBOOK.md`.


### 3e. Auth email templates (internal-only)

GoTrue renders the confirmation / recovery / magic-link / email-change mails from
HTML templates it fetches **over HTTP at send time**. They live in this repo at
`apps/web/emails/` and are served by `apps/web/app/emails/[template]/route.ts`.

Set these on the **Auth (GoTrue) service** in the Supabase Coolify stack — the
**unprefixed** names, not the `GOTRUE_`-prefixed ones:

```
MAILER_TEMPLATES_CONFIRMATION=http://web:3000/emails/confirmation.html
MAILER_TEMPLATES_RECOVERY=http://web:3000/emails/recovery.html
MAILER_TEMPLATES_MAGIC_LINK=http://web:3000/emails/magic-link.html
MAILER_TEMPLATES_EMAIL_CHANGE=http://web:3000/emails/email-change.html
```

> **Setting `GOTRUE_MAILER_TEMPLATES_*` directly does nothing.** That stack's
> compose defines `GOTRUE_MAILER_TEMPLATES_X: ${MAILER_TEMPLATES_X}`, so the
> interpolation overwrites whatever the UI holds for the prefixed name — with an
> empty string when the unprefixed one is unset. Env changes also need a
> **redeploy**, not a restart: the container has to be recreated.

GoTrue and `web` share the external `coolify` network, so this fetch is
container-to-container by compose service alias — no public exposure, no TLS, no
Traefik or Cloudflare in the path. Only the template *source* is internal; the
link the user clicks (`{{ .ConfirmationURL }}`) is built by GoTrue from
`SITE_URL` / `API_EXTERNAL_URL` and stays the public domain.

**The route answers internal callers only.** It returns the template only when
the request carries none of `x-forwarded-for` / `x-forwarded-host` /
`x-forwarded-proto` (Traefik sets all three on anything it forwards, and an
outside client cannot strip them) **and** its `Host` is in
`EMAIL_TEMPLATE_ALLOWED_HOSTS`. Everything else gets a **404, not a 403** — the
public domain should not confirm the path exists.

> `https://<WEB_HOST>/emails/confirmation.html` returning 404 is **correct**.
> Verify from inside the network instead:
> ```bash
> docker compose -f docker-compose.prod.yml exec web \
>   node -e "fetch('http://127.0.0.1:3000/emails/confirmation.html').then(r=>console.log(r.status))"
> ```

**A misconfigured template fails silently.** GoTrue never errors a send over
templating: an empty URL goes straight to the built-in body
(`internal/mailer/templatemailer/template.go`, the `url == ""` branch), and a
*failed fetch* — DNS miss, 404, timeout — falls back to the built-in body too and
**caches that result** (`Cache.load`). So "the mail arrived but looks default"
means one of: the env never reached the process, or the fetch failed. Tell them
apart from inside the auth container:

```bash
# 1. is the config in the process at all?
docker exec <auth> env | grep -i mailer_templates
# 2. can GoTrue's own network namespace reach it?
docker run --rm --network container:<auth> curlimages/curl -sS -i http://web:3000/emails/confirmation.html
# 3. a failed fetch logs this; an empty URL logs nothing
docker logs <auth> --since 1h 2>&1 | grep templatemailer
```

A fetch failure is cached for `GOTRUE_MAILER_TEMPLATE_MAX_AGE` (default 10m) and
retried at most every `GOTRUE_MAILER_TEMPLATE_RETRY_INTERVAL` (default 10s), so
give it a moment after a fix before concluding it did not work.

Gotchas:
- If `web` does not resolve from the Supabase stack (another stack on the shared
  network claims the alias), use the Coolify-generated container name in the URLs
  **and** add that `host:port` to `EMAIL_TEMPLATE_ALLOWED_HOSTS` — GoTrue sends
  whatever host the URL names, and an unlisted host 404s.
- GoTrue caches templates for `GOTRUE_MAILER_TEMPLATE_MAX_AGE` (default 10m).
  After editing a template, wait it out or restart the auth container.
- `emails/` is copied into the prod image explicitly (`apps/web/Dockerfile`);
  `output: "standalone"` does not trace it. Adding a template also means adding
  its filename to the allow-list in the route handler.
- `/emails` stays excluded from the Next middleware matcher — GoTrue fetches with
  no session, and the matcher runs on internal requests too.

---

## 4. Deploying

From the host, with `.env.production` filled in:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`--build` is required whenever a `NEXT_PUBLIC_*` value changed (they are baked into
the web image). Pure runtime-env or DB-setting changes do not need a rebuild.

**Applying migrations.** The Supabase project (config + migrations) is baked into
the api image at `/app/supabase`, so migrations run from inside the worker:

```bash
docker compose -f docker-compose.prod.yml exec api-worker \
  supabase db push --workdir /app --db-url "$DATABASE_URL"
```

The two migrations that define the dispatch path:

- `20260824000000_build_inngest_event.sql` — the `build_inngest_event(uuid)` builder.
- `20260824000100_emit_direct_to_inngest.sql` — the `emit_investigation_requested()`
  trigger function that POSTs via `pg_net`.

Both are **idempotent** (`create or replace function`); re-running is safe.

> **Migrate-on-boot risk.** `docker-compose.prod.yml` sets `RUN_MIGRATIONS: "1"`
> on `api-worker`, so `apps/api/entrypoint.sh` applies **all** pending
> migrations, as the DB owner, on **every** boot of that container — a restart,
> a scale event, or `up -d` all trigger it, not just an intentional release.
> Two consequences:
> - **An image rollback does not roll back schema.** Rolling `IMAGE_TAG` back
>   to a previous version does not undo migrations a newer version already
>   applied; a schema-incompatible rollback needs a manual down-migration.
> - **For a controlled release** (migrate as its own reviewed step, not
>   coupled to every container boot), unset `RUN_MIGRATIONS` in
>   `.env.production` and instead run `supabase db push` as a separate deploy
>   step — either the `exec api-worker` form shown above, or from CI/CD before
>   `up -d`.

---

## 5. First cutover (from the Edge-Function architecture)

Do these **in order** the first time this architecture goes live. Until the DB
settings are applied, the trigger is a deliberate **silent no-op** (its unset-guard
returns without emitting), so rows would insert and sit in `queued` forever with no
error. Apply the settings **before** relying on the new path.

**Step 1 — apply the database settings.**

```bash
psql "$DATABASE_URL" -c "alter database postgres set app.settings.inngest_base_url = 'http://inngest:8288';"
psql "$DATABASE_URL" -c "alter database postgres set app.settings.inngest_event_key = '<INNGEST_EVENT_KEY>';"
```

These are `alter database` settings — existing sessions keep the old values, so
restart the stack (or bounce the Postgres connections) before testing.

**Step 2 — deploy and confirm app sync.**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Open the Inngest dashboard and confirm the `job-hunt-verification` app is synced
and lists both `run-investigation` and `sweep-stale-queued`. If not, use **"Sync
new app"** with `http://api-worker:8000/api/inngest` — that URL is fetched by the
Inngest **server**, not your browser, so internal DNS resolves correctly.

**Step 3 — submit a real investigation.** Through the web UI, watch the row go
`queued → running → done` with `investigation_steps` populating. This exercises the
whole chain: INSERT → trigger → `pg_net` → Inngest → internal callback → graph run.

**Step 4 — confirm no public worker hostname is needed.**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://jobverifai-worker.ronmrcdo.dev/healthz
```

Expect a failure or 404 — the worker route is gone. Investigations must still run.
If they stop, the callback is not resolving internally: re-check that `inngest` can
reach `api-worker:8000` on the `coolify` network, and that `INNGEST_SERVE_ORIGIN`
is set.

**Step 5 — remove the Cloudflare Access carve-outs.** Once runs work end-to-end,
delete the bypass rules for `/fn/register` and `/e/*` on the Inngest host, and the
worker's Access rule entirely. (Keep the `/e/*` carve-out only if §3b forced you
onto the *public* Inngest URL for the DB setting.) Re-run Step 3 afterward to
confirm nothing depended on them.

---

## 6. Operating

**When a run misbehaves, look in this order:**

1. **Inngest dashboard.** Events → search `investigation.requested` by the
   investigation id.
   - Event present, no run → worker/app-sync problem (check §5 Step 2 and worker logs).
   - Event absent → hop 1 failed. Check `net._http_response` for the `pg_net`
     result, and confirm both `app.settings.inngest_*` are set and non-empty.
2. **`investigations` / `investigation_steps` tables.** The row's `status` and the
   per-node step rows show how far the graph got.
3. **Worker logs** (`docker compose -f docker-compose.prod.yml logs api-worker`).
   Exceptions from the graph run surface here.

**Row stuck in `queued`.** The `sweep-stale-queued` cron re-emits it — it is the
backstop for a dropped hop-1 POST (which `pg_net` never retries). If rows *never*
leave `queued` even after the sweep interval, the DB settings are almost certainly
unset (the silent no-op) — see §5 Step 1.

**App sync / re-sync.** The worker advertises its callback URL
(`INNGEST_SERVE_ORIGIN`) during sync. To force a re-sync, use "Sync new app" in the
dashboard with `http://api-worker:8000/api/inngest`.

---

## 7. Known operational gotchas

Hard-won, carried here so they stop living in one person's head:

- **Coolify does not expand `${VAR:-default}` inside Traefik labels.** Hardcode the
  domain and the router hash in labels; a `${...}` there is taken literally.
- **Coolify injects UI-set environment into containers**, shadowing compose values.
  A surprising runtime value → check the Coolify UI env for that service first.
- **The Inngest signing key must be plain, even-length hex.** The server
  length-checks the raw value *before* stripping any `signkey-...` prefix, so a
  prefixed key is rejected. Generate with `openssl rand -hex 32`.
- **`INNGEST_BASICAUTH_USERS` bcrypt hashes must not have their `$` doubled.**
  Compose does not re-interpolate a value substituted from the env file, so paste
  the `htpasswd -nbB` output verbatim. Doubling the `$` corrupts the hash and every
  login fails.
- **The `/e/` event path is intentionally exempt from the dashboard basic auth.**
  The DB trigger POSTs there with `INNGEST_EVENT_KEY` and sends no `Authorization`
  header.
- **`pg_net` can be dropped by a local Supabase stop/start.** The emit trigger
  *warns* (and no-ops) rather than aborting the INSERT if the `net` schema is
  absent — so a submission is never blocked, but emission silently stops until
  `create extension if not exists pg_net;` is re-run.
- **The trigger is a silent no-op when the DB settings are unset.** By design (it
  must never block an insert) — but it means a fresh environment dispatches nothing
  until §3b / §5 Step 1 is applied. There is no error; the symptom is rows parked
  in `queued`.
- **Inngest registration returning "registration_failed / not valid JSON"** usually
  means Cloudflare Access is intercepting the Inngest host — bypass `/fn/register`
  and `/e/*`, not a key problem.
- **Runs marked "Completed" that did nothing** are typically a redirect turning the
  executor's POST into a GET. Ensure the callback URL is exact (no trailing-slash
  redirect).

---

## 8. Rollback

No data migration is involved anywhere in this architecture, so rollback is cheap:

- **Config (§3a, `INNGEST_*`, labels)** — these are environment/compose changes.
  Revert the values and `up -d` (add `--build` only if a `NEXT_PUBLIC_*` changed).
- **The emit trigger (migration `20260824000100`)** — `create or replace function`,
  so re-applying an older version reverts it. The deleted Edge Function is
  recoverable from git history if the Edge-Function path must be restored.
- **The DB settings (§3b)** — `alter database postgres reset app.settings.inngest_base_url;`
  (and `_event_key`) returns the trigger to its no-op state without touching code.

Because the `sweep-stale-queued` cron re-emits anything stuck in `queued`, a botched
cutover degrades to delayed dispatch, not lost investigations.

---

## See also

- [`scripts/smoke_e2e.md`](../scripts/smoke_e2e.md) — end-to-end submission smoke test.
- [`scripts/RUNBOOK.md`](../scripts/RUNBOOK.md) — migrations and RLS verification.
- [`docs/superpowers/specs/2026-08-24-inngest-loop-simplification-design.md`](superpowers/specs/2026-08-24-inngest-loop-simplification-design.md) — the design rationale.
