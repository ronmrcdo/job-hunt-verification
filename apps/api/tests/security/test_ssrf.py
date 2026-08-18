import pytest
from app.security.ssrf import assert_public_url, SsrfError

@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/",  # cloud metadata
    "http://127.0.0.1/",                          # loopback
    "http://localhost/",                          # loopback name
    "http://10.0.0.5/internal",                   # private
    "http://192.168.1.1/",                        # private
    "http://[::1]/",                              # ipv6 loopback
    "ftp://example.com/",                         # non-http scheme
    "file:///etc/passwd",                         # file scheme
])
def test_rejects_dangerous_urls(url, monkeypatch):
    # Force name resolution to return the literal host for name-based cases
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: [h] if _is_ip(h) else _fake_lookup(h))
    with pytest.raises(SsrfError):
        assert_public_url(url)

def test_allows_public_url(monkeypatch):
    monkeypatch.setattr("app.security.ssrf._resolve", lambda h: ["93.184.216.34"])
    assert assert_public_url("https://example.com/jobs/123") is None

def test_wraps_resolution_failure_as_ssrf_error(monkeypatch):
    import socket

    def _raise(h):
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr("app.security.ssrf._resolve", _raise)
    with pytest.raises(SsrfError):
        assert_public_url("https://nonexistent.invalid/")

# helpers used only by the test
def _is_ip(h):
    import ipaddress
    try:
        ipaddress.ip_address(h.strip("[]")); return True
    except ValueError:
        return False

def _fake_lookup(h):
    return {"localhost": ["127.0.0.1"]}.get(h, ["93.184.216.34"])
