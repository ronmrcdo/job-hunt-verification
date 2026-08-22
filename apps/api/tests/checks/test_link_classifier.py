# tests/checks/test_link_classifier.py
from app.checks.link_classifier import classify_link, LinkClass

def c(url, dom="acme.com", verified=True):
    return classify_link(url, canonical_domain=dom, canonical_verified=verified)

def test_own_domain_neutral():
    assert c("https://acme.com/careers/login").kind == "own_domain"

def test_ats_host_neutral():
    assert c("https://acme.greenhouse.io/apply").kind == "ats_allowlisted"

def test_official_app_store_neutral():
    assert c("https://play.google.com/store/apps/details?id=x").kind == "app_store"

def test_direct_executable_dangerous():
    r = c("https://acme-corp-onboard.com/app.apk")
    assert r.kind == "direct_executable" and r.dangerous is True

def test_executable_with_query_stripped():
    assert c("https://x.io/setup.exe?ref=1").kind == "direct_executable"

def test_double_extension_executable():
    assert c("https://x.io/invoice.pdf.scr").kind == "direct_executable"

def test_lookalike_login_when_verified():
    r = c("https://acme-corp.com/login", dom="acme.com", verified=True)
    # acme-corp vs acme is >2 edits; use a real lookalike:
    r = c("https://acme-globall.com/login", dom="acme-global.com", verified=True)
    assert r.kind == "lookalike" and r.dangerous is True

def test_lookalike_not_flagged_when_reference_unverified():
    r = c("https://acme-globall.com/login", dom="acme-global.com", verified=False)
    assert r.kind == "off_domain"  # cannot claim lookalike without a verified ref (S5/Gap A)

def test_open_redirect_on_allowlisted_host_is_unknown():
    # embedded absolute URL in query -> never inherits greenhouse.io's neutral class
    assert c("https://greenhouse.io/redirect?url=https://evil-login.com").kind == "unknown"

def test_open_redirect_in_fragment_is_unknown():
    # embedded absolute URL in fragment -> same guard prevents neutrality
    assert c("https://greenhouse.io/redirect#url=https://evil-login.com").kind == "unknown"

def test_userinfo_confusion_uses_real_host():
    # real host is evil.com, not greenhouse.io
    r = c("https://greenhouse.io@evil.com/login")
    assert r.kind in ("off_domain", "lookalike") and r.host == "evil.com"

def test_app_store_lookalike_host_is_not_neutral():
    # play.google.com.evil.com registrable = evil.com -> executable path -> danger
    assert c("https://play.google.com.evil.com/app.apk").kind == "direct_executable"

def test_ats_name_in_path_is_not_neutral():
    r = c("https://evil.com/greenhouse.io/login")
    assert r.kind != "ats_allowlisted"

def test_shortener_is_unknown():
    assert c("https://bit.ly/3xyz").kind == "unknown"

def test_data_uri_is_dangerous_scheme():
    r = c("data:text/html;base64,PGZvcm0+")
    assert r.kind == "dangerous_scheme" and r.dangerous is True

def test_javascript_scheme_is_dangerous():
    assert c("javascript:steal()").kind == "dangerous_scheme"

def test_unparseable_is_unknown():
    assert c("not a url").kind == "unknown"
