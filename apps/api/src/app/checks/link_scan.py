"""Scan untrusted text for weaponized-recruitment links and emit findings (§9.7).

Deterministic. Runs over pasted job text (user_provided_unverified) and any
backend-fetched posting (web_verified); the classifier decides danger, this
module decides finding type, severity, and the user_safety_alert flag.
"""
import re
from app.graph.state import Finding, Provenance
from app.checks.link_classifier import classify_link, LinkClass

_URL_RE = re.compile(r"(?:https?://|data:|blob:|javascript:)[^\s)\]}'\"<>]+", re.I)

_LOGIN_MARKERS = ("login", "log-in", "signin", "sign-in", "account", "verify",
                  "authenticate", "credential", "password")
_SIGNUP_MARKERS = ("register", "signup", "sign-up", "registration",
                   "portal", "onboard", "apply")


def extract_urls(text: str) -> list[str]:
    return _URL_RE.findall(text or "")
