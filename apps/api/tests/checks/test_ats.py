from app.checks.ats_allowlist import is_ats_domain


def test_known_ats_is_allowlisted():
    assert is_ats_domain("boards.greenhouse.io") is True
    assert is_ats_domain("jobs.lever.co") is True
    assert is_ats_domain("acme.myworkday.com") is True


def test_random_domain_is_not_ats():
    assert is_ats_domain("acme-careers.xyz") is False


def test_ats_domain_as_a_path_suffix_is_not_ats():
    # "greenhouse.io" appearing as a label prefix elsewhere in the string
    # must not fool the suffix match.
    assert is_ats_domain("greenhouse.io.attacker.com") is False


def test_ats_lookalike_prefix_is_not_ats():
    assert is_ats_domain("evilgreenhouse.io") is False
