from app.checks.link_scan import extract_urls

def test_extracts_http_urls():
    urls = extract_urls("apply at https://x.io/a and http://y.io/b now")
    assert urls == ["https://x.io/a", "http://y.io/b"]

def test_extracts_data_uri():
    assert "data:text/html;base64,AAA" in extract_urls("see data:text/html;base64,AAA end")

def test_no_urls():
    assert extract_urls("no links here") == []


def _scan(text, prov="user_provided_unverified", dom="acme.com", verified=True):
    from app.checks.link_scan import scan_links
    return scan_links(text, provenance=prov, canonical_domain=dom, canonical_verified=verified)

def test_executable_download_is_alert_high():
    fs = _scan("install our app: https://x.io/app.apk")
    assert len(fs) == 1
    f = fs[0]
    assert f.severity == "high" and f.user_safety_alert is True
    assert f.direction == "suspicious" and f.category == "communication"
    assert "download" in f.claim.lower()
    assert f.provenance == "user_provided_unverified"

def test_own_domain_login_emits_no_finding():
    assert _scan("log in at https://acme.com/login") == []

def test_ats_signup_emits_no_finding():
    assert _scan("register at https://acme.greenhouse.io/apply") == []

def test_offdomain_login_is_alert():
    fs = _scan("verify identity: https://acme-verify-portal.io/login")
    assert fs and fs[0].user_safety_alert is True and "login" in fs[0].claim.lower()

def test_lookalike_login_web_verified_marks_lookalike_claim():
    fs = _scan("log in https://acme-globall.com/login", prov="web_verified",
               dom="acme-global.com", verified=True)
    assert fs and "lookalike" in fs[0].claim.lower() and fs[0].provenance == "web_verified"

def test_unknown_link_is_soft_no_alert():
    fs = _scan("continue: https://bit.ly/x")
    assert fs and fs[0].user_safety_alert is False and fs[0].severity in ("info", "low")

def test_signup_offdomain_is_soft():
    fs = _scan("sign up at https://third-party-jobs.io/register")
    assert fs and fs[0].severity in ("low", "medium")

def test_source_ids_propagate_to_findings():
    from app.checks.link_scan import scan_links
    fs = scan_links("install https://x.io/app.apk", provenance="user_provided_unverified",
                    canonical_domain="acme.com", canonical_verified=True,
                    source_ids=["src_det_posting"])
    assert fs and fs[0].source_ids == ["src_det_posting"]
