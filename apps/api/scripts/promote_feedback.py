"""Component 8: turn admin-approved eval_candidate rows into dataset-shaped
cases, append them to eval/dataset.json, and mark the candidates exported.

The output is a DIFF for a human to open as a PR — this script never commits or
pushes, and never writes the dataset without an admin having promoted the
candidate first (spec Global Constraints: no silent write to canon).

Pure transforms (`candidate_to_case`, `append_new_cases`) are unit-tested with
no DB. `main()` reads/updates eval_candidate over a privileged DB connection
(operator env PROMOTE_DATABASE_URL) — not exercised in CI, like the repo's other
DB-gated code.

Two ways in, because production Postgres sits on an internal Coolify network
with no route from an operator laptop:

    # A. Direct DB (only where the database is actually reachable):
    cd apps/api && PROMOTE_DATABASE_URL=... uv run scripts/promote_feedback.py

    # B. File handoff (the normal path): download the pending candidates from
    #    /admin, merge them here, PR the diff, then mark them exported back in
    #    /admin using the ids this prints.
    cd apps/api && uv run scripts/promote_feedback.py --from-file ~/Downloads/candidates.json

Both modes share `candidate_to_case`/`append_new_cases`, so the dataset case
shape has exactly one definition regardless of how the rows arrived.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
from typing import Any

DATASET = pathlib.Path(__file__).resolve().parents[1] / "eval" / "dataset.json"

_BANDS = ("LOW", "MODERATE", "HIGH", "CRITICAL")


def candidate_to_case(candidate: dict[str, Any]) -> dict[str, Any]:
    """Dataset-shaped case with a stable, collision-free id.

    id = feedback_<investigation_id[:8]>_<candidate_id[:12]>, where
    candidate_id is the eval_candidate row's own uuid primary key with
    dashes stripped. Identity-based (not positional): the SAME candidate
    always maps to the SAME id, so re-offering it (e.g. a retry after a
    partial failure) is naturally idempotent, and two DIFFERENT candidates
    for the same investigation always get different ids since their uuids
    differ. 12 hex chars (48 bits) keeps collisions negligible — a collision
    would silently skip a candidate, the exact failure this id scheme exists
    to prevent. Tags always include 'source:feedback' for provenance;
    origin_investigation_id keeps traceability back to the run.
    """
    inv = str(candidate["investigation_id"])
    cand_id = str(candidate["id"]).replace("-", "")
    max_band = candidate["expected_max_band"]
    if max_band not in _BANDS:
        raise ValueError(f"bad expected_max_band: {max_band}")
    tags = list(candidate.get("tags") or [])
    if "source:feedback" not in tags:
        tags.append("source:feedback")
    return {
        "id": f"feedback_{inv[:8]}_{cand_id[:12]}",
        "description": f"Promoted from feedback on investigation {inv}.",
        "submission": candidate["submission_snapshot"],
        # The loader requires expected_band; fall back to the ceiling when the
        # admin only set a max.
        "expected_band": candidate.get("expected_band") or max_band,
        "expected_max_band": max_band,
        "tags": tags,
        "origin_investigation_id": inv,
        "v1_only": False,
    }


def append_new_cases(
    dataset: list[dict[str, Any]], candidates: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Append candidates not already present. Idempotent: an id already in the
    dataset is skipped, so re-running never duplicates. Returns (new_dataset,
    appended_ids)."""
    existing = {c["id"] for c in dataset}
    out = list(dataset)
    added: list[str] = []
    for cand in candidates:
        case = candidate_to_case(cand)
        if case["id"] in existing:
            continue
        existing.add(case["id"])
        out.append(case)
        added.append(case["id"])
    return out, added


def reconcile(
    dataset: list[dict[str, Any]], candidates: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[Any]]:
    """Pure reconciliation between the dataset file and the promoted-candidate
    rows: appends whatever isn't in the dataset yet (same as `append_new_cases`),
    and separately reports every candidate DB id whose case ends up present in
    the resulting dataset — whether appended just now or already there from a
    prior partial run.

    This is what main() uses to decide which DB rows to mark 'exported', and it
    fixes two related bugs in a naive "UPDATE ... where status='promoted'"
    approach: (1) a candidate already in the dataset from an earlier run that
    crashed before its status update would otherwise never get exported
    (stranded); (2) a candidate promoted concurrently, after the SELECT but
    before the UPDATE, would otherwise get marked exported without ever being
    written to the dataset (silent loss). Scoping export ids to "case is
    actually present in new_dataset" closes both: presence, not blanket
    status, is the source of truth for what counts as exported.
    """
    new_dataset, _added = append_new_cases(dataset, candidates)
    present = {c["id"] for c in new_dataset}
    export_ids = [cand["id"] for cand in candidates if candidate_to_case(cand)["id"] in present]
    return new_dataset, export_ids


def load_candidates(raw: str) -> list[dict[str, Any]]:
    """Parse the JSON downloaded from /admin's eval export.

    Accepts the download's envelope ({"generated_at", "candidates": [...]}) or a
    bare list, so a hand-trimmed file still works. Anything else is a paste of
    the wrong thing — fail loudly rather than silently merging zero cases.
    """
    payload = json.loads(raw)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("candidates"), list):
        return payload["candidates"]
    raise ValueError("expected a list of candidates, or an object with a 'candidates' list")


def merge_from_file(src: pathlib.Path, dataset_path: pathlib.Path = DATASET) -> tuple[list[str], list[str]]:
    """Merge downloaded candidates into the dataset. No DB, no network.

    Returns (added case ids, candidate ids safe to mark exported). The status
    flip happens later and elsewhere (the /admin action), so this half of the
    flow can be re-run freely: `append_new_cases` dedupes on the stable case id,
    which makes a second run a no-op rather than a duplicate.

    Unlike main(), this does NOT write to a temp file and swap: with no DB
    transaction to order against, the failure mode that protects against cannot
    occur — and a half-written dataset.json in a git working tree is visible in
    `git diff` anyway.
    """
    dataset = json.loads(dataset_path.read_text())
    old_ids = {c["id"] for c in dataset}
    candidates = load_candidates(src.read_text())
    new_dataset, export_ids = reconcile(dataset, candidates)
    added = [c["id"] for c in new_dataset if c["id"] not in old_ids]
    dataset_path.write_text(json.dumps(new_dataset, indent=2) + "\n")
    return added, export_ids


def main() -> None:  # pragma: no cover - DB-bound operator entrypoint
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-file",
        type=pathlib.Path,
        metavar="PATH",
        help="Merge candidates from a JSON file downloaded from /admin instead of reading the DB.",
    )
    args = parser.parse_args()

    if args.from_file:
        added, export_ids = merge_from_file(args.from_file)
        if not added:
            print("No new cases — every candidate in that file is already in the dataset.")
        else:
            print(f"Appended {len(added)} case(s): {', '.join(added)}")
            print("Review `git diff apps/api/eval/dataset.json` and open a PR — nothing was committed.")
        if export_ids:
            print("\nAfter the PR merges, paste these ids into /admin → Mark exported:")
            print(",".join(export_ids))
        return

    import psycopg  # local import so unit tests need no driver

    url = os.environ["PROMOTE_DATABASE_URL"]
    dataset = json.loads(DATASET.read_text())
    old_ids = {c["id"] for c in dataset}
    with psycopg.connect(url, autocommit=False) as conn:
        rows = conn.execute(
            "select id, investigation_id, submission_snapshot, expected_max_band, "
            "expected_band, tags from eval_candidate where status = 'promoted' "
            "order by created_at"
        ).fetchall()
        cols = ["id", "investigation_id", "submission_snapshot", "expected_max_band", "expected_band", "tags"]
        candidates = [dict(zip(cols, r)) for r in rows]

        new_dataset, export_ids = reconcile(dataset, candidates)
        added = [c["id"] for c in new_dataset if c["id"] not in old_ids]
        if not added and not export_ids:
            print("No new candidates to promote.")
            return

        # Ordering matters: write the dataset to a TEMP file first, then update
        # DB status, then commit, then atomically swap the temp file into place
        # last. If the process dies before the swap, the DB has committed rows
        # as 'exported' but DATASET on disk is untouched — a re-run reads the
        # same (unwritten) dataset, `reconcile` recomputes the same export_ids
        # (their cases are still absent from the on-disk dataset) and appends
        # them again, self-healing. The alternative ordering (swap before
        # commit) risks a crash between the two leaving the dataset file
        # updated but the DB rows still 'promoted' forever un-exported, which
        # is exactly the stranding bug this rewrite fixes — so we accept this
        # smaller window instead.
        tmp = DATASET.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(new_dataset, indent=2) + "\n")
        if export_ids:
            conn.execute(
                "update eval_candidate set status = 'exported', exported_at = now() "
                "where id = any(%s)",
                (export_ids,),
            )
        conn.commit()
        os.replace(tmp, DATASET)
    print(f"Appended {len(added)} case(s): {', '.join(added)}")
    print("Review `git diff apps/api/eval/dataset.json` and open a PR — nothing was committed.")


if __name__ == "__main__":  # pragma: no cover
    main()
