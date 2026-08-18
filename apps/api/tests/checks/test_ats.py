from app.checks.ats_allowlist import is_ats_domain


def test_known_ats_is_allowlisted():
    assert is_ats_domain("boards.greenhouse.io") is True
    assert is_ats_domain("jobs.lever.co") is True
    assert is_ats_domain("acme.myworkday.com") is True


def test_random_domain_is_not_ats():
    assert is_ats_domain("acme-careers.xyz") is False
