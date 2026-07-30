import secrets
import time

from app.config import settings

_tokens: dict[str, tuple[float, str | None]] = {}


def _purge() -> None:
    now = time.monotonic()
    expired = [t for t, (exp, _) in _tokens.items() if exp <= now]
    for t in expired:
        del _tokens[t]


def issue_ws_token(client_ip: str | None = None) -> str:
    _purge()
    token = secrets.token_urlsafe(32)
    _tokens[token] = (time.monotonic() + settings.ws_token_ttl, client_ip)
    return token


def consume_ws_token(token: str | None, client_ip: str | None = None) -> bool:
    if not token:
        return False
    _purge()
    record = _tokens.pop(token, None)
    if record is None:
        return False
    expires, bound_ip = record
    if time.monotonic() > expires:
        return False
    if bound_ip and client_ip and bound_ip != client_ip:
        return False
    return True


def client_ip_from_headers(forwarded_for: str | None, direct: str | None) -> str | None:
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or None
    return direct
