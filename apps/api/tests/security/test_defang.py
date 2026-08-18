from app.security.defang import defang_url, contains_accusation


def test_defang():
    assert defang_url("https://acme-globall.com/pay") == "hxxps://acme-globall[.]com/pay"
    assert defang_url("http://x.io") == "hxxp://x[.]io"


def test_accusation_detection():
    assert contains_accusation("Acme Global is a scam.") is True
    assert contains_accusation("This posting is fraudulent.") is True
    assert contains_accusation("We found 3 signals consistent with known scam patterns.") is False
