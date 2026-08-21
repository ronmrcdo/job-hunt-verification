from app.checks.job_boards import is_job_board_domain, is_non_employer_domain


def test_known_job_board_is_recognized():
    assert is_job_board_domain("linkedin.com") is True
    assert is_job_board_domain("www.indeed.com") is True
    assert is_job_board_domain("ziprecruiter.com") is True


def test_employer_domain_is_not_a_job_board():
    assert is_job_board_domain("acme.com") is False


def test_job_board_lookalike_prefix_is_not_a_job_board():
    assert is_job_board_domain("evillinkedin.com") is False


def test_job_board_as_a_label_prefix_is_not_a_job_board():
    assert is_job_board_domain("linkedin.com.attacker.net") is False


def test_non_employer_covers_both_boards_and_ats():
    # Neither a board nor an ATS host is ever the employer's own domain --
    # scoring domain age / MX / email-match against them measures the wrong
    # company entirely.
    assert is_non_employer_domain("linkedin.com") is True
    assert is_non_employer_domain("boards.greenhouse.io") is True
    assert is_non_employer_domain("acme.com") is False
