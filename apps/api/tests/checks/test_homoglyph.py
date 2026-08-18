from app.checks.homoglyph import homoglyph_hit


def test_edit_distance_lookalike():
    assert homoglyph_hit("acme-globall.com", "acme-global.com") is True


def test_rn_for_m_lookalike():
    assert homoglyph_hit("rnicrosoft.com", "microsoft.com") is True


def test_punycode_is_flagged():
    assert homoglyph_hit("xn--pple-43d.com", "apple.com") is True  # 'аpple' cyrillic a


def test_punycode_decoding_to_unrelated_label_not_a_hit():
    # decodes to 'totallydifférent', which is nowhere near 'acme-global' —
    # a legitimate IDN candidate must not be blanket-flagged just for
    # being punycode.
    assert homoglyph_hit("xn--totallydiffrent-lnb.com", "acme-global.com") is False


def test_identical_domain_not_a_hit():
    assert homoglyph_hit("acme-global.com", "acme-global.com") is False


def test_unrelated_domain_not_a_hit():
    assert homoglyph_hit("totally-different.com", "acme-global.com") is False


def test_no_reference_domain_not_a_hit():
    assert homoglyph_hit("anything.com", None) is False


# Multi-part TLD (ccTLD) regression tests (devil finding #5): `_label` used
# to take `parts[-2]`, which for "acme-globall.co.uk" is just "co" — so the
# lookalike class was invisible on ccTLDs. tldextract's registrable-label
# extraction fixes this by knowing "co.uk" is the public suffix.
def test_edit_distance_lookalike_across_cctld():
    assert homoglyph_hit("acme-globall.co.uk", "acme-global.com") is True


def test_rn_for_m_lookalike_across_cctld():
    assert homoglyph_hit("rnicrosoft.co.uk", "microsoft.com") is True


def test_paypal_lookalike_across_cctld():
    assert homoglyph_hit("paypa1.co.uk", "paypal.com") is True


def test_identical_registrable_label_different_cctld_not_a_hit():
    # Same registrable label under a different ccTLD is not itself a
    # lookalike signal (a real company can legitimately hold both).
    assert homoglyph_hit("acme-global.co.uk", "acme-global.com") is False
