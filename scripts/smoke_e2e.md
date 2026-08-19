# Smoke Test: V1 End-to-End Investigation Flow

**⚠️ Operator-run only. The implementation NEVER executes this script.** This document is how
the operator validates that the V1 backend stack (Supabase + Inngest + Python worker) can
accept and process an investigation end-to-end via the public Supabase Auth and PostgREST
APIs. It stands in for a full UI integration test.

---

## Prerequisites

Before running this smoke test, ensure all of the following are in place:

1. **Local Supabase stack running**: `supabase start` is up, with Postgres/Auth/Realtime/Functions.
   Note the printed `SUPABASE_URL`, `anon key`, and `DB URL`.

2. **Migrations applied and RLS verified**: Follow steps 1–3 in `scripts/RUNBOOK.md`:
   - Apply migrations: `supabase migration up` (or `supabase db push` for hosted).
   - Verify RLS and CHECK constraints: `psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/verify_rls.sql`.
   
   Both must complete with `OK` notices and no errors.

3. **Edge Function deployed with secrets**: The `emit-investigation-requested` Edge Function
   must be deployed to the local stack with its required environment secrets set:

   ```bash
   supabase secrets set INNGEST_EVENT_URL=<inngest-dev-server-url> INNGEST_EVENT_KEY=<key>
   ```

   For local development, `INNGEST_EVENT_URL` typically points to the Inngest Dev Server
   (e.g., `http://localhost:8288`).

4. **Inngest Dev Server running**: `npx inngest-cli dev` is running in a separate terminal.
   This accepts webhook events and exposes a dashboard at `http://localhost:8288`.

5. **Python worker running**: The `apps/api` worker is running via its ASGI entrypoint
   (e.g., `uv run python -m uvicorn app.worker.app:app --host 0.0.0.0 --port 8000`).
   The worker serves the Inngest endpoint at `/api/inngest` (where the Inngest Dev Server
   must send webhook events) alongside the `/healthz` liveness check.
   
   Environment variables must be set:
   - `DATABASE_URL`: Supabase local Postgres connection string (from `supabase status`).
   - `INNGEST_EVENT_KEY`: Same value set in the Edge Function secrets.
   - `INNGEST_SIGNING_KEY`: The signing key for verifying Inngest webhook signatures.

6. **A confirmed user in Auth**: Create or use an existing user in the Supabase Auth system.
   If using the local stack, create one via the Auth Admin API or the Supabase Studio UI.
   Record the user's email and password (or a recovery code).

---

## Smoke Test Steps

### Step 1: Sign in and obtain a JWT access token

Sign in via the Supabase GoTrue (Auth) REST API to obtain a JWT access token. This token
represents the authenticated user and will be sent in the `Authorization` header for all
subsequent requests.

**Replace `<SUPABASE_URL>`, `<anon-key>`, `<email>`, `<password>` with your values:**

```bash
export SUPABASE_URL="http://localhost:54321"
export ANON_KEY="<your-anon-key>"
export USER_EMAIL="test@example.com"
export USER_PASSWORD="test-password"

RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${USER_EMAIL}\", \"password\": \"${USER_PASSWORD}\"}")

export ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')
echo "Signed in. Access token: $ACCESS_TOKEN"
```

Save the `ACCESS_TOKEN` for use in the remaining steps.

---

### Step 2: Submit an investigation

Insert an investigation row via the Supabase PostgREST API. The `submission` JSON must
contain a `job_text` field; the `user_id` column DEFAULTs to `auth.uid()`, and RLS's WITH
CHECK verifies `user_id = auth.uid()`. The AFTER INSERT trigger will force `status='queued'`
and null out server columns (assessment, findings, what_to_verify, cost, check_count).

The AFTER INSERT trigger also fires the `emit-investigation-requested` Edge Function, which
sends an `investigation.requested` event to the Inngest Dev Server.

**Run with the same environment variables from Step 1:**

```bash
JOB_TEXT="We are seeking a Senior Software Engineer with 5+ years of experience in TypeScript and React. Responsibilities include leading frontend architecture, mentoring junior developers, and collaborating across teams. Competitive salary, remote work available, and comprehensive benefits package."

INVESTIGATION_RESPONSE=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/investigations" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"submission\": {\"job_text\": \"${JOB_TEXT}\"}}")

export INVESTIGATION_ID=$(echo "$INVESTIGATION_RESPONSE" | jq -r '.[0].id')
export INVESTIGATION_STATUS=$(echo "$INVESTIGATION_RESPONSE" | jq -r '.[0].status')

echo "Investigation created:"
echo "  ID: $INVESTIGATION_ID"
echo "  Status: $INVESTIGATION_STATUS (should be 'queued')"
```

The returned row's `status` should be `queued`. All server columns (assessment, findings,
what_to_verify, cost, check_count) should be null or absent.

---

### Step 3: Observe investigation steps arriving over Realtime

As the Python worker processes the investigation, the `investigation_steps` table will
receive INSERT events signaling progress: pending → running → done. If you have a Realtime
client available (e.g., using the Supabase JavaScript client or a CLI tool), subscribe
to the steps table filtered by `investigation_id`:

**Option A: Using `supabase-cli` with a Realtime subscription** (if available):

```bash
# This is a pseudo-command; consult your Realtime client library for exact syntax.
# Example using Supabase JS client or `wscat` against the Realtime endpoint:
# You can poll instead (see Option B).
```

**Option B: Poll the investigation_steps table** (simpler for manual testing):

```bash
echo "Polling investigation_steps... (ctrl+C to stop)"
while true; do
  STEPS=$(curl -s \
    "${SUPABASE_URL}/rest/v1/investigation_steps?investigation_id=eq.${INVESTIGATION_ID}&order=display_order.asc" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")
  
  echo "Steps count: $(echo "$STEPS" | jq 'length')"
  echo "$STEPS" | jq '.[] | {step_key, status, display_order}'
  
  # Also check the investigation row's status
  INV=$(curl -s \
    "${SUPABASE_URL}/rest/v1/investigations?id=eq.${INVESTIGATION_ID}" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")
  
  INV_STATUS=$(echo "$INV" | jq -r '.[0].status')
  echo "Investigation status: $INV_STATUS"
  
  # If status is done, failed, or deadline_exceeded, exit
  if [[ "$INV_STATUS" == "done" ]] || [[ "$INV_STATUS" == "failed" ]] || [[ "$INV_STATUS" == "deadline_exceeded" ]]; then
    echo "Investigation reached terminal status: $INV_STATUS"
    break
  fi
  
  sleep 2
done
```

**Expected flow:**
- `investigation_steps` table receives rows with statuses progressing from `pending` → `running` → `done`.
- Each step corresponds to a node in the LangGraph investigation runner.
- The parent `investigations` row's status progresses from `queued` → `running` → `done`.
- If any step fails, the investigation may reach `failed` or `deadline_exceeded`.

If no steps appear and the investigation remains `queued` after a reasonable wait
(30+ seconds), skip to the Troubleshooting section below.

---

### Step 4: Verify the completed investigation

Once the investigation reaches a terminal status (done, failed, or deadline_exceeded),
fetch the final row and verify that server-side columns are populated:

```bash
FINAL=$(curl -s \
  "${SUPABASE_URL}/rest/v1/investigations?id=eq.${INVESTIGATION_ID}" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

echo "Final investigation row:"
echo "$FINAL" | jq '.[0]'

# Extract key fields
FINAL_STATUS=$(echo "$FINAL" | jq -r '.[0].status')
ASSESSMENT=$(echo "$FINAL" | jq -r '.[0].assessment')
FINDINGS=$(echo "$FINAL" | jq -r '.[0].findings')
WHAT_TO_VERIFY=$(echo "$FINAL" | jq -r '.[0].what_to_verify')

echo ""
echo "Summary:"
echo "  Status: $FINAL_STATUS"
echo "  Assessment is populated: $([ "$ASSESSMENT" != "null" ] && echo "✓" || echo "✗")"
echo "  Findings is populated: $([ "$FINDINGS" != "null" ] && echo "✓" || echo "✗")"
echo "  What to verify is populated: $([ "$WHAT_TO_VERIFY" != "null" ] && echo "✓" || echo "✗")"
```

**Expected results on success:**
- `status` is `done`, `failed`, or `deadline_exceeded`.
- For a `done` status: `assessment`, `findings`, and `what_to_verify` are populated with non-null JSON objects.
- Source excerpts (within findings or assessment) are defanged (domains/URLs masked or removed) and capped in length.

---

## Troubleshooting

If the investigation remains stuck in `queued` after Step 2, or no `investigation_steps`
arrive:

1. **Check the Edge Function logs** for errors:
   ```bash
   supabase functions logs emit-investigation-requested
   ```
   
   Look for any error messages indicating a failed HTTP POST to Inngest, missing secrets,
   or a malformed webhook payload.

2. **Check the Inngest Dev Server dashboard** at `http://localhost:8288`:
   - Navigate to Events and search for `investigation.requested` with the investigation ID.
   - If the event appears, the Edge Function succeeded; the issue is downstream in the worker.
   - If the event is missing, the Edge Function either failed to fire or failed to POST to Inngest.

3. **Check the Python worker logs**:
   - Look for any exceptions or error traces in the ASGI server's stdout/stderr.
   - Verify that `DATABASE_URL`, `INNGEST_EVENT_KEY`, and `INNGEST_SIGNING_KEY` are set correctly.

4. **§6 stale-queued sweeper**:
   - The spec defines a background job (stale-queued sweeper) that periodically detects investigations
     stuck in `queued` and retries or fails them after a deadline.
   - If the main webhook flow fails end-to-end, the sweeper is the backstop to prevent investigations
     from hanging indefinitely.

For detailed migration and RLS troubleshooting, consult `scripts/RUNBOOK.md`.

---

## See Also

- `scripts/RUNBOOK.md` — how to apply migrations and verify RLS after a fresh deployment.
