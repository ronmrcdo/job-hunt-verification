"""Shared registrable-suffix matching for the domain allowlists/denylists.

`acme.greenhouse.io` is Greenhouse; `greenhouse.io.attacker.com` and
`evilgreenhouse.io` are not. Every domain-set check in `checks/` matches
on label boundaries through this one helper.
"""


def registrable_suffix_match(domain: str, suffix: str) -> bool:
    d = domain.lower().rstrip(".")
    return d == suffix or d.endswith("." + suffix)


def matches_any(domain: str, suffixes) -> bool:
    return any(registrable_suffix_match(domain, s) for s in suffixes)
