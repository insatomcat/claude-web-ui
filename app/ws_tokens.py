import secrets
import time

from app.config import settings

_tokens: dict[str, float] = {}


def _purge() -> None:
    now = time.monotonic()
    expired = [t for t, exp in _tokens.items() if exp <= now]
    for t in expired:
        del _tokens[t]


def issue_ws_token() -> str:
    _purge()
    token = secrets.token_urlsafe(32)
    _tokens[token] = time.monotonic() + settings.ws_token_ttl
    return token


def consume_ws_token(token: str | None) -> bool:
    if not token:
        return False
    _purge()
    expires = _tokens.pop(token, None)
    if expires is None:
        return False
    return time.monotonic() <= expires
