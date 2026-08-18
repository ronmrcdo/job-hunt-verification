"""Homoglyph / lookalike domain detector.

Flags domains that visually mimic a known-real domain via small edit
distance, punycode/IDN encoding, or the classic 'rn' -> 'm' substitution.
Per spec §7/§9 this is a V0-blocking scam signal (e.g. `rnicrosoft.com`,
`acme-globall.com`).
"""


def _label(domain: str) -> str:
    # registrable label without the public suffix's TLD, lowercased
    parts = domain.lower().rstrip(".").split(".")
    return parts[-2] if len(parts) >= 2 else parts[0]


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _is_lookalike(cand: str, ref: str) -> bool:
    if cand == ref:
        return False
    # Common substitution: 'rn' visually reads as 'm'
    if cand.replace("rn", "m") == ref or cand == ref.replace("m", "rn"):
        return True
    dist = _levenshtein(cand, ref)
    return 1 <= dist <= 2 and abs(len(cand) - len(ref)) <= 2


def homoglyph_hit(candidate: str, real: str | None) -> bool:
    if not real:
        return False
    cand, ref = _label(candidate), _label(real)
    if cand == ref:
        return False
    # Punycode / IDN candidate: decode to its Unicode form and run the same
    # lookalike comparison against the real label, instead of blanket-flagging
    # every xn-- domain (which false-positives on legitimate IDNs).
    if "xn--" in cand:
        try:
            decoded = cand.encode("ascii").decode("idna")
        except UnicodeError:
            return True  # malformed punycode is not a legitimate domain
        if decoded == ref:
            return False
        return _is_lookalike(decoded, ref)
    return _is_lookalike(cand, ref)
