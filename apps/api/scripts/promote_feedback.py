"""Component 8: turn admin-approved eval_candidate rows into dataset-shaped
cases, append them to eval/dataset.json, and mark the candidates exported.

The output is a DIFF for a human to open as a PR — this script never commits or
pushes, and never writes the dataset without an admin having promoted the
candidate first (spec Global Constraints: no silent write to canon).

Pure transforms (`candidate_to_case`, `append_new_cases`) are unit-tested with
no DB. `main()` reads/updates eval_candidate over a privileged DB connection
(operator env PROMOTE_DATABASE_URL) — not exercised in CI, like the repo's other
DB-gated code.

Run:
    cd apps/api && PROMOTE_DATABASE_URL=... uv run scripts/promote_feedback.py
"""
from __future__ import annotations

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


def main() -> None:  # pragma: no cover - DB-bound operator entrypoint
    import psycopg  # local import so unit tests need no driver

    url = os.environ["PROMOTE_DATABASE_URL"]
    dataset = json.loads(DATASET.read_text())
    with psycopg.connect(url, autocommit=False) as conn:
        rows = conn.execute(
            "select id, investigation_id, submission_snapshot, expected_max_band, "
            "expected_band, tags from eval_candidate where status = 'promoted' "
            "order by created_at"
        ).fetchall()
        cols = ["id", "investigation_id", "submission_snapshot", "expected_max_band", "expected_band", "tags"]
        candidates = [dict(zip(cols, r)) for r in rows]

        new_dataset, added = append_new_cases(dataset, candidates)
        if not added:
            print("No new candidates to promote.")
            return

        DATASET.write_text(json.dumps(new_dataset, indent=2) + "\n")
        conn.execute(
            "update eval_candidate set status = 'exported', exported_at = now() "
            "where status = 'promoted'"
        )
        # No explicit commit: psycopg3 commits automatically on clean `with` exit.
    print(f"Appended {len(added)} case(s): {', '.join(added)}")
    print("Review `git diff apps/api/eval/dataset.json` and open a PR — nothing was committed.")


if __name__ == "__main__":  # pragma: no cover
    main()
