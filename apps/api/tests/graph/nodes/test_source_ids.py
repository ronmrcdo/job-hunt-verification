from app.graph.nodes.research import stable_source_id


def test_stable_id_is_deterministic_and_url_specific():
    a = stable_source_id("raw", "https://example.com/jobs/1")
    b = stable_source_id("raw", "https://example.com/jobs/1")
    c = stable_source_id("raw", "https://example.com/jobs/2")
    assert a == b            # stable across calls (not PYTHONHASHSEED-dependent)
    assert a != c            # different URLs -> different ids
    assert a.startswith("raw_")
    assert len(a) > len("raw_") + 8   # wide hash, collision-resistant
