import json, subprocess, sys

def test_openapi_contains_core_schemas():
    out = subprocess.run([sys.executable, "scripts/dump_openapi.py"],
                         capture_output=True, text=True, check=True)
    spec = json.loads(out.stdout)
    schemas = spec["components"]["schemas"]
    assert "Finding" in schemas
    assert "FinalAssessment" in schemas
    assert "InvestigationResponse" in schemas
    # band is a fixed enum, never a free number (no percentages leak into the contract)
    band = schemas["FinalAssessment"]["properties"]["band"]
    assert set(band["enum"]) == {"LOW", "MODERATE", "HIGH", "CRITICAL"}
