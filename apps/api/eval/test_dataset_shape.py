import json, pathlib

def test_dataset_has_required_span():
    data = json.loads(pathlib.Path(__file__).with_name("dataset.json").read_text())
    v0 = [c for c in data if not c.get("v1_only")]
    assert len(v0) >= 15
    tags = {t for c in data for t in c["tags"]}
    for required in ("legit", "obvious_scam", "homoglyph", "staffing_agency",
                     "contact_swap", "injection", "awkward_but_legit"):
        assert required in tags, f"missing case tag: {required}"
    for c in data:
        assert c["expected_band"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")
        assert "job_text" in c["submission"]
