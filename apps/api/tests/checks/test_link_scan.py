from app.checks.link_scan import extract_urls, extract_anchor_urls, scan_links

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


# --- fetched-HTML scanning (§9.7): scan real anchor links, not page markup ---

def test_extract_anchor_urls_keeps_only_href_targets():
    html = (
        '<html prefix="og: http://ogp.me/ns#">'
        '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        '<script type="application/ld+json">{"@context":"https://schema.org"}</script>'
        '<img src="https://cdn.example.com/banner.png">'
        '<link rel="stylesheet" href="https://cdn.example.com/app.css">'
        '<a href="https://real-destination.io/apply">apply</a>'
    )
    urls = extract_anchor_urls(html)
    # Only the <a href> absolute link survives; namespaces, JSON-LD, <img>,
    # and non-anchor <link>/<script> asset URLs are markup, not destinations.
    assert urls == ["https://real-destination.io/apply"]
    assert not any("ogp.me" in u or "schema.org" in u or "w3.org" in u for u in urls)
    assert not any("banner.png" in u or "app.css" in u for u in urls)

def test_extract_anchor_urls_handles_single_quotes_and_entities():
    html = "<a href='https://x.io/apply?a=1&amp;b=2'>x</a>"
    assert extract_anchor_urls(html) == ["https://x.io/apply?a=1&b=2"]

def test_extract_anchor_urls_keeps_dangerous_scheme_hrefs():
    html = '<a href="javascript:alert(1)">x</a><a href="data:text/html,PGZvcm0+">y</a>'
    assert extract_anchor_urls(html) == ["javascript:alert(1)", "data:text/html,PGZvcm0+"]

def test_extract_anchor_urls_drops_relative_and_fragment_links():
    html = '<a href="/job/123">a</a><a href="#top">b</a><a href="mailto:x@y.io">c</a>'
    assert extract_anchor_urls(html) == []

def test_html_scan_suppresses_same_site_navigation():
    # A fetched job-board page links to itself all over its chrome. Those
    # same-site anchors are navigation, not a weaponized-recruitment signal.
    html = (
        '<a href="https://ph.jobstreet.com/job/93712310">this job</a>'
        '<a href="https://id.jobstreet.com/">Indonesia</a>'          # sibling subdomain
        '<a href="https://ph.jobstreet.com/companies/x">employer</a>'
    )
    fs = scan_links(html, provenance="web_verified", canonical_domain=None,
                    canonical_verified=False, html=True,
                    page_domain="ph.jobstreet.com")
    assert fs == []

def test_html_scan_still_flags_genuine_off_site_anchor():
    html = ('<a href="https://ph.jobstreet.com/job/1">self</a>'
            '<a href="https://hk.jobsdb.com/">HK board</a>')
    fs = scan_links(html, provenance="web_verified", canonical_domain=None,
                    canonical_verified=False, html=True,
                    page_domain="ph.jobstreet.com")
    assert len(fs) == 1 and "jobsdb.com" in fs[0].claim

def test_html_scan_still_flags_same_site_executable_download():
    # Same-site suppression covers off_domain navigation only — a runnable
    # download on the page's own host is still a §9.7 signal.
    html = '<a href="https://ph.jobstreet.com/files/setup.exe">get the app</a>'
    fs = scan_links(html, provenance="web_verified", canonical_domain=None,
                    canonical_verified=False, html=True,
                    page_domain="ph.jobstreet.com")
    assert len(fs) == 1 and fs[0].user_safety_alert is True
    assert "download" in fs[0].claim.lower()
