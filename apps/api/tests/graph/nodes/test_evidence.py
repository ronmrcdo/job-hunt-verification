from datetime import datetime, timezone
from app.graph.state import InvestigationState, RawSubmission, Source, Finding
from app.graph.nodes.evidence import evidence_assembly

def _s(id_, url, summary="s"):
    return Source(id=id_, url=url, kind="search_result",
                  retrieved_at=datetime.now(timezone.utc), content_summary=summary, raw_excerpt=summary)

def test_dedupes_and_assigns_canonical_ids():
    state = InvestigationState(
        submission=RawSubmission(job_text="x"),
        raw_sources=[_s("raw_1", "https://a"), _s("raw_2", "https://a"),  # dup url
                 _s("src_det_domain", None, "det")],
        raw_findings=[Finding(id="f1", category="job", direction="suspicious", severity="low",
                          claim="c", source_ids=["raw_2"], provenance="web_verified")])
    out = evidence_assembly(state)
    ids = {s.id for s in out["sources"]}
    assert "src_det_domain" in ids                       # deterministic id preserved
    assert any(i.startswith("src_0") for i in ids)       # canonical web ids
    assert len([s for s in out["sources"] if s.url == "https://a"]) == 1  # deduped
    # finding remapped from raw_2 → whatever canonical id that url got
    remapped = out["findings"][0].source_ids[0]
    assert remapped != "raw_2" and remapped.startswith("src_0")


def test_multiple_findings_can_share_same_deterministic_source_id():
    state = InvestigationState(
        submission=RawSubmission(job_text="x"),
        raw_sources=[_s("src_det_domain", None, "det")],
        raw_findings=[
            Finding(id="f1", category="job", direction="suspicious", severity="low",
                    claim="c1", source_ids=["src_det_domain"], provenance="deterministic"),
            Finding(id="f2", category="domain", direction="suspicious", severity="medium",
                    claim="c2", source_ids=["src_det_domain"], provenance="deterministic"),
        ])
    out = evidence_assembly(state)
    assert out["findings"][0].source_ids == ["src_det_domain"]
    assert out["findings"][1].source_ids == ["src_det_domain"]
    assert len(out["sources"]) == 1


def test_unknown_cited_source_id_is_kept_not_dropped():
    # A finding citing an id that isn't in state.sources at all (e.g. a stale/unknown
    # provisional id) should not cause the finding to be silently dropped.
    state = InvestigationState(
        submission=RawSubmission(job_text="x"),
        raw_sources=[_s("raw_1", "https://a")],
        raw_findings=[Finding(id="f1", category="job", direction="suspicious", severity="low",
                          claim="c", source_ids=["raw_missing"], provenance="web_verified")])
    out = evidence_assembly(state)
    assert len(out["findings"]) == 1
    assert out["findings"][0].source_ids == ["raw_missing"]
