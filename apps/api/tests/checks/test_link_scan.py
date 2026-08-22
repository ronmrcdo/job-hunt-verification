from app.checks.link_scan import extract_urls

def test_extracts_http_urls():
    urls = extract_urls("apply at https://x.io/a and http://y.io/b now")
    assert urls == ["https://x.io/a", "http://y.io/b"]

def test_extracts_data_uri():
    assert "data:text/html;base64,AAA" in extract_urls("see data:text/html;base64,AAA end")

def test_no_urls():
    assert extract_urls("no links here") == []
