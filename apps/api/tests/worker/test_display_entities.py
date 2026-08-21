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
