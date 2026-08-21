# Report Submitted-Details Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the report's confidence-panel detail grid render the prototype's four rows — JOB, COMPANY, RECRUITER, EMAIL — by persisting the worker's extracted entities and reading them in the view model, instead of echoing only the two fields the user happened to type.

**Architecture:** The intake node already extracts company/job/salary from the posting, but everything except a collapsed `title` string dies with the graph run — there is no `entities` column, so `toReportViewModel` can only echo `inv.submission`, and a submission with blank optional fields produces zero rows (`SubmittedGrid` returns `null`). This plan (1) adds `recruiter_name`/`contact_channel` to the intake extraction, (2) persists a five-field display whitelist as `investigations.entities` jsonb — defanged on write, nulled by the insert-defaults trigger, exactly like `title` — and (3) builds `submitted` from entities with the submission as the trusted override for company and the only source for email.

**Tech Stack:** Python 3.12 / pydantic / pytest / LangGraph (apps/api), Postgres + Supabase migrations, Next.js 16 / React 19 / TypeScript / vitest (apps/web).

**Spec:** `docs/superpowers/specs/2026-08-19-v1-web-supabase-integration-design.md` (§ report read path, `Investigation` row shape) and `docs/superpowers/specs/2026-08-18-job-hunt-verification-design.md` (§9 trust boundaries). The visual target is the design-handoff prototype's confidence panel, transcribed in `apps/web/lib/__fixtures__/sample-high.ts` — JOB `Virtual Assistant, $2,500/month`, COMPANY `Acme Global`, RECRUITER `John Smith · Telegram`, EMAIL `acmeglobalcareers@gmail.com`.

## Global Constraints

- **The LLM never supplies the recruiter email.** `intake_extraction` takes `recruiter_email` verbatim from the immutable `RawSubmission` (`apps/api/src/app/graph/nodes/intake.py:53`); the report's EMAIL row must do the same — `inv.submission.recruiter_email` only, never `entities`.
- **All user-submitted and posting-derived text is untrusted (spec §9.2).** New LLM-facing input stays inside the existing `<<<...>>>` delimited blocks; never in system prose.
- **Every client-visible string the worker writes is defanged.** `Persistence` is the only writer of client-visible data (`apps/api/src/app/worker/persistence.py:1-5`); run each persisted entity string through `defang_text`, same as `title` at line 119.
- **Worker-set columns are nulled on insert.** Any new column must be added to the `force_investigation_defaults()` trigger body, re-asserted **in full** — the current body lives in `supabase/migrations/20260821140000_public_stats.sql:60-74` and includes `finished_at`.
- **Migrations are operator-applied and their tests are text assertions**, not executed SQL — follow `apps/api/tests/migrations/test_public_stats.py`.
- **Rule #4 (no hyperlinks in the report):** grid values stay plain label/value pairs; never an `<a href>`.
- Test commands: API `cd apps/api && uv run pytest <path> -v`; web `cd apps/web && pnpm vitest run <path>`.
- Per project convention, commit steps are omitted from this plan.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/app/graph/state.py` | `ExtractedEntities` gains `recruiter_name`, `contact_channel`. |
| `apps/api/src/app/graph/nodes/intake.py` | `_IntakeLLM` gains the same two fields; merge them into `ExtractedEntities`. |
| `apps/api/src/app/worker/persistence.py` | New `display_entities()` helper (whitelist + defang) and an `entities` parameter on `persist_result`. |
| `apps/api/src/app/worker/functions.py` | Pass `state.entities` on the live path; read `cached.get("entities")` on the cache-hit path; include it in the cache write. |
| `supabase/migrations/20260822000000_investigations_entities.sql` | Add the `entities jsonb` column; re-assert the defaults trigger with `new.entities := null`. |
| `apps/web/lib/database.types.ts` | Hand-maintained row type gains `entities: Json \| null`. |
| `apps/web/lib/investigations.ts` | New `Entities` type; `Investigation.entities`. |
| `apps/web/lib/report-view-model.ts` | Build the four rows from entities + submission. |
| `apps/web/lib/__fixtures__/sample-high.ts`, `sample-low.ts` | Carry `entities` so fixtures match a real row. |
| `apps/web/components/investigation/InvestigationView.tsx` | Progress-header company label falls back to the derived `title`. |

---

### Task 1: Extract recruiter name and contact channel at intake

The prototype's RECRUITER row reads `John Smith · Telegram`. Neither half exists anywhere in the system today — `_IntakeLLM` has no such fields — so this row can never render until intake reads them out of the posting.

**Files:**
- Modify: `apps/api/src/app/graph/state.py:22-30`
- Modify: `apps/api/src/app/graph/nodes/intake.py:9-21`, `:48-57`
- Test: `apps/api/tests/graph/nodes/test_intake.py`

**Interfaces:**
- Produces: `ExtractedEntities.recruiter_name: str | None`, `ExtractedEntities.contact_channel: str | None` — consumed by Task 2 (`display_entities`) and, through the persisted jsonb, by Task 3.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/graph/nodes/test_intake.py`:

```python
@pytest.mark.asyncio
async def test_intake_carries_recruiter_name_and_channel(monkeypatch):
    # The report's RECRUITER row is "<name> · <channel>" (design prototype).
    # Both halves are read from the posting text by the LLM; neither has a
    # RawSubmission field to fall back to.
    llm_out = ExtractedEntities(recruiter_name="John Smith", contact_channel="Telegram")

    async def fake_call(model, schema, messages, *, node):
        assert "recruiter_name" in schema.model_fields
        assert "contact_channel" in schema.model_fields
        return llm_out, NodeUsage(node=node, model="cheap", usd=0.0)

    monkeypatch.setattr(intake, "structured_call", fake_call)

    state = InvestigationState(submission=RawSubmission(
        job_text="Message John Smith on Telegram to start."))
    ent = (await intake.intake_extraction(state))["entities"]
    assert ent.recruiter_name == "John Smith"
    assert ent.contact_channel == "Telegram"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && uv run pytest tests/graph/nodes/test_intake.py::test_intake_carries_recruiter_name_and_channel -v`
Expected: FAIL — `ValidationError` / `TypeError` on the unknown `recruiter_name` keyword to `ExtractedEntities`.

- [ ] **Step 3: Add the fields to the state model**

In `apps/api/src/app/graph/state.py`, inside `class ExtractedEntities`, after `salary`:

```python
    recruiter_name: str | None = None
    contact_channel: str | None = None   # "Telegram", "WhatsApp", "email" …
```

- [ ] **Step 4: Add the fields to the LLM schema and the merge**

In `apps/api/src/app/graph/nodes/intake.py`, inside `class _IntakeLLM`, after `salary`:

```python
    recruiter_name: str | None = None
    contact_channel: str | None = Field(
        None, description="Where the recruiter asks to be contacted, e.g. Telegram, WhatsApp, email"
    )
```

and in the `ExtractedEntities(...)` construction, after `salary=llm_out.salary,`:

```python
        recruiter_name=llm_out.recruiter_name,
        contact_channel=llm_out.contact_channel,
```

- [ ] **Step 5: Run the whole intake suite**

Run: `cd apps/api && uv run pytest tests/graph/nodes/test_intake.py -v`
Expected: PASS — the new test plus the four existing ones (merge, untrusted delimiting, truncation).

---

### Task 2: Persist the display entities

**Files:**
- Create: `supabase/migrations/20260822000000_investigations_entities.sql`
- Modify: `apps/api/src/app/worker/persistence.py:14-31` (add `display_entities`), `:102-127` (`persist_result`)
- Modify: `apps/api/src/app/worker/functions.py:44-51`, `:69-81`
- Test: `apps/api/tests/worker/test_functions.py`, `apps/api/tests/migrations/test_worker_table_rls.py`

**Interfaces:**
- Consumes: `ExtractedEntities.recruiter_name` / `.contact_channel` from Task 1.
- Produces: `display_entities(entities) -> dict | None` in `app.worker.persistence` — a defanged dict whose keys are exactly `company_name, job_title, salary, recruiter_name, contact_channel`, or `None` when every value is empty. `Persistence.persist_result(..., entities=None)` writes it to the `entities` jsonb column. Task 3 reads that shape from the client.

- [ ] **Step 1: Write the failing worker tests**

Append to `apps/api/tests/worker/test_functions.py`:

```python
async def test_persists_display_entities(monkeypatch):
    from app.graph.state import ExtractedEntities
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)

    async def run(inv, sub, sink):
        st = InvestigationState(submission=sub, entities=ExtractedEntities(
            company_name="Acme Global", job_title="Virtual Assistant", salary="$2,500/month",
            recruiter_name="John Smith", contact_channel="Telegram"))
        return st, "done"

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"] == {
        "company_name": "Acme Global", "job_title": "Virtual Assistant",
        "salary": "$2,500/month", "recruiter_name": "John Smith",
        "contact_channel": "Telegram",
    }


async def test_entities_is_none_when_nothing_extracted(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: None)

    async def run(inv, sub, sink):
        return InvestigationState(submission=sub), "done"

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"] is None


async def test_cache_hit_passes_cached_entities(monkeypatch):
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")

    async def cached(_k):
        return {"assessment": None, "findings": [], "sources": [], "cost": {},
                "what_to_verify": [], "title": "Acme Global",
                "entities": {"company_name": "Acme Global", "job_title": None,
                             "salary": None, "recruiter_name": None,
                             "contact_channel": None}}

    async def bump(_k):
        return 2

    monkeypatch.setattr(functions.cache, "get_cached_report", cached)
    monkeypatch.setattr(functions.cache, "bump_check_count", bump)

    async def run(inv, sub, sink):
        raise AssertionError("cache hit must not run the graph")

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"]["company_name"] == "Acme Global"
```

Also append, in the same file, the round-trip guard for entries cached before this change:

```python
async def test_cache_hit_without_entities_persists_none(monkeypatch):
    # Reports cached before the entities column existed have no such key;
    # the read path must not KeyError on them.
    p = FakePersistence(RawSubmission(job_text="x"))
    monkeypatch.setattr(functions.cache, "dedupe_key", lambda s: "k")

    async def cached(_k):
        return {"assessment": None, "findings": [], "sources": [], "cost": {},
                "what_to_verify": []}

    async def bump(_k):
        return 2

    monkeypatch.setattr(functions.cache, "get_cached_report", cached)
    monkeypatch.setattr(functions.cache, "bump_check_count", bump)

    async def run(inv, sub, sink):
        raise AssertionError("cache hit must not run the graph")

    await functions.handle_requested(uuid.uuid4(), persistence=p, run=run)
    assert p.result["entities"] is None
```

- [ ] **Step 2: Write the failing defang/whitelist test**

Create `apps/api/tests/worker/test_display_entities.py`:

```python
from app.graph.state import ExtractedEntities
from app.worker.persistence import display_entities


def test_returns_none_when_nothing_was_extracted():
    assert display_entities(ExtractedEntities()) is None
    assert display_entities(None) is None


def test_defangs_urls_in_client_visible_values():
    # Entity text originates in the untrusted posting, so a recruiter who
    # names themselves "Careers http://acme-global.co" must not put a live
    # scheme into the report (same rule as finding claims and title).
    out = display_entities(ExtractedEntities(recruiter_name="Careers http://acme-global.co"))
    assert "http://" not in out["recruiter_name"]


def test_whitelists_only_display_fields():
    # company_domain / candidate_real_domain / key_phrases are internal
    # signals for the checks nodes — they are not part of the report grid.
    out = display_entities(ExtractedEntities(
        company_name="Acme", company_domain="acme.co",
        candidate_real_domain="acme.com", key_phrases=["urgent start"]))
    assert set(out) == {"company_name", "job_title", "salary",
                        "recruiter_name", "contact_channel"}
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `cd apps/api && uv run pytest tests/worker/test_display_entities.py tests/worker/test_functions.py -v`
Expected: FAIL — `ImportError: cannot import name 'display_entities'`, and the `test_functions.py` additions fail on `KeyError: 'entities'`.

- [ ] **Step 4: Implement `display_entities` and the `entities` write**

In `apps/api/src/app/worker/persistence.py`, after the `shape()` function:

```python
# The client-visible subset of ExtractedEntities: exactly the fields the
# report's detail grid renders (job, company, recruiter, channel). The
# internal signals the checks nodes use — company_domain,
# candidate_real_domain, key_phrases — deliberately stay server-side.
_DISPLAY_FIELDS = ("company_name", "job_title", "salary", "recruiter_name", "contact_channel")


def display_entities(entities) -> dict | None:
    """Whitelist + defang the extracted entities for storage. Returns None
    when the posting yielded none of them, so the column stays null rather
    than holding an all-null object the client would have to special-case."""
    if entities is None:
        return None
    out = {f: getattr(entities, f, None) for f in _DISPLAY_FIELDS}
    if not any(out.values()):
        return None
    return {k: (defang_text(v) if v else None) for k, v in out.items()}
```

In `persist_result`, add the keyword argument and the column. Change the signature line to:

```python
    async def persist_result(self, inv_id, *, assessment, findings, sources, cost,
                             what_to_verify, check_count=None, status=None, title=None,
                             entities=None) -> None:
```

append to `args` (after the `title` entry):

```python
            json.dumps(entities) if entities else None,
```

and extend `set_cols`:

```python
        set_cols = ("assessment=%s, findings=%s, sources=%s, cost=%s, "
                    "what_to_verify=%s, check_count=%s, title=%s, entities=%s")
```

Note in the existing docstring comment block that `entities` arrives already whitelisted and defanged by `display_entities` — `persist_result` does not re-defang it.

- [ ] **Step 5: Wire the worker paths**

In `apps/api/src/app/worker/functions.py`, add the import:

```python
from app.worker.persistence import Persistence, display_entities, shape
```

On the cache-hit call, after `title=cached.get("title"),`:

```python
                entities=cached.get("entities"),
```

On the live path, replace the `title = _title(state.entities)` block through the `persist_result` call with:

```python
    title = _title(state.entities)
    entities = display_entities(state.entities)
    await persistence.persist_result(inv_id, assessment=state.assessment, findings=state.findings,
                                     sources=state.sources, cost=cost, what_to_verify=what,
                                     title=title, entities=entities,
                                     status=status)   # atomic 'done' | 'deadline_exceeded'
```

and add `entities` to the cache payload, alongside `"title": title`:

```python
            "cost": cost, "what_to_verify": shaped_what, "title": title,
            "entities": entities})
```

- [ ] **Step 6: Run the worker suites**

Run: `cd apps/api && uv run pytest tests/worker/ -v`
Expected: PASS — including the pre-existing title and cache tests, which must not change behavior.

- [ ] **Step 7: Write the failing migration test**

Append to `apps/api/tests/migrations/test_worker_table_rls.py`, next to the existing title assertions:

```python
ENTITIES = (MIGRATIONS / "20260822000000_investigations_entities.sql").read_text().lower() \
    if (MIGRATIONS / "20260822000000_investigations_entities.sql").exists() else ""


def test_entities_column_added_and_nulled_in_defaults_trigger():
    assert "add column if not exists entities jsonb" in ENTITIES
    assert "new.entities := null" in ENTITIES  # worker-set only; client can't seed it


def test_entities_migration_reasserts_full_defaults_trigger_body():
    # create-or-replace REPLACES the whole body: every column the earlier
    # migrations null must be repeated here or its guard is silently lost.
    for line in ("new.status := 'queued'", "new.check_count := null",
                 "new.assessment := null", "new.findings := null",
                 "new.sources := null", "new.cost := null",
                 "new.what_to_verify := null", "new.started_at := null",
                 "new.title := null", "new.finished_at := null"):
        assert line in ENTITIES
```

- [ ] **Step 8: Run the migration test to verify it fails**

Run: `cd apps/api && uv run pytest tests/migrations/test_worker_table_rls.py -v`
Expected: FAIL — `ENTITIES` is `""`, so every `in` assertion fails.

- [ ] **Step 9: Write the migration**

Create `supabase/migrations/20260822000000_investigations_entities.sql`:

```sql
-- supabase/migrations/20260822000000_investigations_entities.sql
-- Adds the worker-extracted display entities so the report's detail grid can
-- show JOB / COMPANY / RECRUITER / EMAIL even when the user pasted only the
-- posting text. Before this column the intake node's extraction was collapsed
-- into the single `title` string and everything else died with the graph run,
-- so the grid rendered nothing for a submission with blank optional fields.
--
-- Shape (written by persistence.display_entities, all values defanged):
--   {"company_name": text|null, "job_title": text|null, "salary": text|null,
--    "recruiter_name": text|null, "contact_channel": text|null}
-- The email is deliberately NOT here: the report reads it from `submission`,
-- verbatim from the user, never from LLM output (spec §9.2).
-- Worker-set only; the insert-defaults trigger nulls any client-supplied value.
-- OPERATOR: apply after 20260821140000_public_stats.sql.

alter table investigations add column if not exists entities jsonb;

-- Re-assert the full insert-defaults trigger body (last defined in
-- 20260821140000_public_stats.sql) with entities nulled too, so a client
-- cannot seed report content on insert.
create or replace function force_investigation_defaults()
returns trigger language plpgsql as $$
begin
  new.status := 'queued';
  new.check_count := null;
  new.assessment := null;
  new.findings := null;
  new.sources := null;
  new.cost := null;
  new.what_to_verify := null;
  new.started_at := null;
  new.title := null;
  new.finished_at := null;
  new.entities := null;
  return new;
end $$;
```

- [ ] **Step 10: Run the migration tests**

Run: `cd apps/api && uv run pytest tests/migrations/ -v`
Expected: PASS — the two new assertions plus the existing title/public-stats trigger tests.

- [ ] **Step 11: Apply the migration locally and confirm the column**

Run: `supabase migration up` (or `supabase db reset` if the local stack is disposable), then:
`supabase db query "select column_name from information_schema.columns where table_name='investigations' and column_name='entities'"`
Expected: one row, `entities`. If the local stack is not running, note in the handoff that this migration is operator-applied and unverified locally.

---

### Task 3: Build the four grid rows from entities

**Files:**
- Modify: `apps/web/lib/database.types.ts:15-28`
- Modify: `apps/web/lib/investigations.ts:29-49`
- Modify: `apps/web/lib/report-view-model.ts:274-289`
- Modify: `apps/web/lib/__fixtures__/sample-high.ts`, `apps/web/lib/__fixtures__/sample-low.ts`
- Test: `apps/web/lib/__tests__/product-rules.test.tsx:130-154`, `apps/web/components/report/__tests__/ConfidencePanel.test.tsx`

**Interfaces:**
- Consumes: the `entities` jsonb shape produced by Task 2 — keys `company_name, job_title, salary, recruiter_name, contact_channel`, each `string | null`.
- Produces: `Entities` exported from `apps/web/lib/investigations.ts`; `Investigation.entities: Entities | null`; `vm.submitted` rows labelled `Job`, `Company`, `Recruiter`, `Email`, `Posting` in that order.

- [ ] **Step 1: Write the failing view-model tests**

Replace the `describe("product rules: submitted rows reflect only present fields", ...)` block in `apps/web/lib/__tests__/product-rules.test.tsx` with:

```tsx
describe("product rules: submitted rows come from entities + submission", () => {
  // The grid mirrors the design prototype's confidence panel: JOB, COMPANY,
  // RECRUITER, EMAIL. Job title/salary and recruiter name/channel exist only
  // on the worker-extracted `entities`; the email is read from `submission`
  // verbatim and never from LLM output (spec §9.2).
  it("HIGH vm.submitted has all four prototype rows in order", () => {
    const vm = toReportViewModel(SAMPLE_HIGH.inv);

    expect(vm.submitted.slice(0, 4)).toEqual([
      { label: "Job", value: "Virtual Assistant, $2,500/month" },
      { label: "Company", value: "Acme Global" },
      { label: "Recruiter", value: "John Smith · Telegram" },
      { label: "Email", value: "acmeglobalcareers@gmail.com", mono: true },
    ]);
  });

  it("falls back to the extracted company when the user typed none", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "x" },
    });

    expect(vm.submitted).toContainEqual({ label: "Company", value: "Acme Global" });
  });

  it("never sources the Email row from entities", () => {
    // A posting that names a contact address must not put it in the EMAIL
    // row: that row means "the address you gave us", nothing else.
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "x" },
    });

    expect(vm.submitted.map((r) => r.label)).not.toContain("Email");
  });

  it("omits a row whose halves are both missing", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "x" },
      entities: null,
    });

    expect(vm.submitted).toEqual([]);
  });

  it("renders a half-known row without a dangling separator", () => {
    const vm = toReportViewModel({
      ...SAMPLE_HIGH.inv,
      submission: { job_text: "x" },
      entities: { job_title: "Virtual Assistant", recruiter_name: "John Smith" },
    });

    expect(vm.submitted).toContainEqual({ label: "Job", value: "Virtual Assistant" });
    expect(vm.submitted).toContainEqual({ label: "Recruiter", value: "John Smith" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run lib/__tests__/product-rules.test.tsx`
Expected: FAIL — TypeScript rejects the unknown `entities` property, and the row assertions fail because only Company/Email are produced.

- [ ] **Step 3: Add the `Entities` type**

In `apps/web/lib/investigations.ts`, above `export type Investigation`:

```ts
// Worker-extracted display entities (written by the intake node, whitelisted
// and defanged by persistence.display_entities). Null when the posting named
// none of them, and null for every run that finished before the entities
// column existed — the view model treats both the same.
export type Entities = {
  company_name?: string | null;
  job_title?: string | null;
  salary?: string | null;
  recruiter_name?: string | null;
  contact_channel?: string | null;
};
```

and add the field to `Investigation`, under `title`:

```ts
  entities: Entities | null;
```

In `apps/web/lib/database.types.ts`, add `entities: Json | null;` to the `investigations` `Row` after `title`, and add the new migration filename to the header comment list at the top of the file.

- [ ] **Step 4: Build the rows**

In `apps/web/lib/report-view-model.ts`, replace the comment and the two `submittedRows.push` blocks at lines 274-281 with:

```ts
  // The grid mirrors the prototype's confidence panel: JOB, COMPANY,
  // RECRUITER, EMAIL. Job title/salary and recruiter name/channel are only
  // ever worker-extracted (`entities`); the company prefers what the user
  // typed and falls back to the extraction; the email is read from the
  // submission alone — it is taken verbatim from the user upstream and must
  // never come from LLM output (spec §9.2).
  const ent = inv.entities ?? {};
  const submittedRows: { label: string; value: string; mono?: boolean }[] = [];
  // join() over a filtered pair, so a half-known row reads "John Smith"
  // rather than "John Smith · " with a dangling separator.
  const pair = (parts: (string | null | undefined)[], sep: string) =>
    parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);

  const job = pair([ent.job_title, ent.salary], ", ");
  if (job) submittedRows.push({ label: "Job", value: job });

  const company = inv.submission.company_name ?? ent.company_name ?? null;
  if (company) submittedRows.push({ label: "Company", value: company });

  const recruiter = pair([ent.recruiter_name, ent.contact_channel], " · ");
  if (recruiter) submittedRows.push({ label: "Recruiter", value: recruiter });

  if (inv.submission.recruiter_email !== undefined)
    submittedRows.push({ label: "Email", value: inv.submission.recruiter_email, mono: true });
```

- [ ] **Step 5: Give the fixtures an `entities` value**

In `apps/web/lib/__fixtures__/sample-high.ts`, after `title: "Acme Global",`:

```ts
    // Transcribed from the prototype's confidence panel: JOB "Virtual
    // Assistant, $2,500/month", RECRUITER "John Smith · Telegram".
    entities: {
      company_name: "Acme Global",
      job_title: "Virtual Assistant",
      salary: "$2,500/month",
      recruiter_name: "John Smith",
      contact_channel: "Telegram",
    },
```

In `apps/web/lib/__fixtures__/sample-low.ts`, add the matching field next to its `title`:

```ts
    entities: {
      company_name: "Northwind Systems",
      job_title: null,
      salary: null,
      recruiter_name: null,
      contact_channel: null,
    },
```

- [ ] **Step 6: Run the view-model and fixture suites**

Run: `cd apps/web && pnpm vitest run lib/__tests__/product-rules.test.tsx lib/__tests__/report-view-model.test.ts lib/__fixtures__/__tests__/fixtures.test.ts`
Expected: PASS. If `report-view-model.test.ts` or `investigations-live.test.ts` construct `Investigation` literals, add `entities: null` to them — the compiler names each site.

- [ ] **Step 7: Update the panel test to assert the rendered grid**

In `apps/web/components/report/__tests__/ConfidencePanel.test.tsx`, replace the `"renders no grid rows when submission has no company_name/recruiter_email"` case with:

```tsx
  it("renders no grid rows when neither the submission nor the entities name anything", () => {
    render(
      <ConfidencePanel
        vm={toReportViewModel({
          ...SAMPLE_HIGH.inv,
          submission: { job_text: "x" },
          entities: null,
        }) as CompleteReportVM}
      />,
    );

    expect(document.querySelectorAll("[data-submitted-row]")).toHaveLength(0);
  });

  it("renders the four prototype rows when the worker extracted them", () => {
    render(<ConfidencePanel vm={toReportViewModel(SAMPLE_HIGH.inv) as CompleteReportVM} />);

    expect(document.querySelectorAll("[data-submitted-row]").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("Virtual Assistant, $2,500/month")).toBeInTheDocument();
    expect(screen.getByText("John Smith · Telegram")).toBeInTheDocument();
  });
```

Keep the file's existing imports; add `screen` from `@testing-library/react` and `SAMPLE_HIGH` / `toReportViewModel` / `CompleteReportVM` if the file does not already import them.

- [ ] **Step 8: Run the report component suite**

Run: `cd apps/web && pnpm vitest run components/report/`
Expected: PASS.

- [ ] **Step 9: Run the full web suite and typecheck**

Run: `cd apps/web && pnpm vitest run && pnpm exec tsc --noEmit`
Expected: PASS with no type errors — this is what catches any remaining `Investigation` literal missing `entities`.

---

### Task 4: Name the company in the progress header

The same root cause shows on the live/progress screen: `InvestigationView` reads `investigation.submission.company_name` and renders "The company · the posting" for any submission with a blank company field. The worker-derived `title` is already on the row and already carries the extracted company (falling back to job title), so this is a one-line fallback.

**Files:**
- Modify: `apps/web/components/investigation/InvestigationView.tsx:54`
- Test: `apps/web/components/investigation/__tests__/InvestigationView.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `Investigation.title` (existing) and `Investigation.entities` from Task 3.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/components/investigation/__tests__/InvestigationView.test.tsx` (create the file with the same imports the neighbouring component tests use if it does not exist):

```tsx
it("names the company from the extraction when the user typed none", () => {
  render(
    <InvestigationView
      investigation={{ ...SAMPLE_HIGH.inv, status: "running", submission: { job_text: "x" } }}
      steps={[]}
    />,
  );

  expect(screen.getByText(/Acme Global · the posting/)).toBeInTheDocument();
});

it("falls back to 'The company' when nothing named it", () => {
  render(
    <InvestigationView
      investigation={{
        ...SAMPLE_HIGH.inv,
        status: "running",
        submission: { job_text: "x" },
        title: null,
        entities: null,
      }}
      steps={[]}
    />,
  );

  expect(screen.getByText(/The company · the posting/)).toBeInTheDocument();
});
```

Match the real prop names and required props of `InvestigationView` when writing this — read the component's props interface first and adjust the two literals rather than inventing a shape.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run components/investigation/`
Expected: FAIL on the first case — the rendered text is "The company · the posting" because `submission.company_name` is undefined.

- [ ] **Step 3: Add the fallback**

In `apps/web/components/investigation/InvestigationView.tsx`, change line 54 to:

```tsx
          {investigation.submission.company_name ||
            investigation.entities?.company_name ||
            investigation.title ||
            "The company"}{" "}
          · the posting. Steps close
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run components/investigation/`
Expected: PASS — both cases.

- [ ] **Step 5: Verify end to end against a real run**

Run the stack, submit a posting with the Company field left blank, and confirm: the progress header names the company, and the finished report shows the JOB / COMPANY / RECRUITER / EMAIL grid under the confidence note. Note that runs completed *before* this migration have `entities = null` and will still show an empty grid — that is expected, not a regression.

---

## Notes for the executor

- **The V0 FastAPI app (`apps/api/src/app/main.py`) is deliberately untouched.** The web client reads investigations straight from Supabase (`getInvestigation` → `.select("*")`), so `InvestigationResponse` plays no part in this path; V0 teardown is tracked separately.
- **`.select("*")` means no query changes are needed** for the new column anywhere in `apps/web/lib/investigations.ts`.
- **Grants are table-level** (`grant select, insert on investigations to authenticated`), so the new column needs no grant change; RLS still restricts rows to `auth.uid()`.
