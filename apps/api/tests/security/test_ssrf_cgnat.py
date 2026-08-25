import pytest
from app.security.ssrf import resolve_public_ips, SsrfError


def test_cgnat_range_is_rejected():
    with pytest.raises(SsrfError):
        resolve_public_ips("100.64.0.1")


def test_ordinary_public_ip_still_allowed():
    assert resolve_public_ips("93.184.216.34") == ["93.184.216.34"]
