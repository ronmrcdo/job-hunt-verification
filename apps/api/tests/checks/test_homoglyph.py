from app.checks.homoglyph import homoglyph_hit


def test_edit_distance_lookalike():
    assert homoglyph_hit("acme-globall.com", "acme-global.com") is True


def test_rn_for_m_lookalike():
    assert homoglyph_hit("rnicrosoft.com", "microsoft.com") is True


def test_punycode_is_flagged():
    assert homoglyph_hit("xn--pple-43d.com", "apple.com") is True  # 'аpple' cyrillic a


def test_identical_domain_not_a_hit():
    assert homoglyph_hit("acme-global.com", "acme-global.com") is False


def test_unrelated_domain_not_a_hit():
    assert homoglyph_hit("totally-different.com", "acme-global.com") is False


def test_no_reference_domain_not_a_hit():
    assert homoglyph_hit("anything.com", None) is False
