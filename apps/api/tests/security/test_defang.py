from app.security.defang import defang_url, defang_text, contains_accusation


def test_defang():
    assert defang_url("https://acme-globall.com/pay") == "hxxps://acme-globall[.]com/pay"
    assert defang_url("http://x.io") == "hxxp://x[.]io"


def test_defang_mixed_case_host():
    # Devil's advocate finding #7: urlparse lowercases parsed.hostname, so a
    # literal (case-sensitive) replace against the original-case host used to
    # silently no-op, leaving mixed-case hosts un-bracketed.
    out = defang_url("https://EVIL.com/x")
    assert "EVIL[.]com" in out
    assert "EVIL.com" not in out
    assert out.startswith("hxxps://")


def test_defang_text_scrubs_urls_in_finding_claim_text():
    claim = "The posting links to https://EVIL.com/apply for the application form."
    out = defang_text(claim)
    assert "https://EVIL.com" not in out
    assert "hxxps://EVIL[.]com" in out


def test_defang_url_malformed_netloc_does_not_crash():
    # Python 3.12's urlsplit raises ValueError when the netloc holds a bracket
    # that isn't a valid IPv6 (e.g. a junk Tavily hit URL). defang_url is
    # output-safety for hostile URLs, so it must neutralize the scheme rather
    # than crash the whole persist path.
    out = defang_url("http://exa[mple].com/x")
    assert out.startswith("hxxp://")
    assert "http://" not in out


def test_defang_text_tolerates_malformed_url():
    out = defang_text("see http://exa[mple].com/x now")
    assert "hxxp://" in out
    assert "http://" not in out


def test_accusation_detection():
    assert contains_accusation("Acme Global is a scam.") is True
    assert contains_accusation("This posting is fraudulent.") is True
    assert contains_accusation("We found 3 signals consistent with known scam patterns.") is False
