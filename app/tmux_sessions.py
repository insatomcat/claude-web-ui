import os
import re
import secrets
import subprocess
import time
from dataclasses import dataclass
from shlex import quote

from app.config import settings

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
TMUX_PREFIX = "cw-"


@dataclass
class SessionRecord:
    session_id: str
    cwd: str
    tmux_name: str
    created_at: float
    last_seen: float


_registry: dict[str, SessionRecord] = {}


def _tmux_name(session_id: str) -> str:
    return f"{TMUX_PREFIX}{session_id}"


def _tmux_alive(name: str) -> bool:
    try:
        return (
            subprocess.run(
                ["tmux", "has-session", "-t", name],
                capture_output=True,
                timeout=5,
            ).returncode
            == 0
        )
    except (subprocess.TimeoutExpired, OSError):
        return False


def _purge_idle() -> None:
    cutoff = time.monotonic() - settings.session_idle_ttl
    for session_id, rec in list(_registry.items()):
        stale = rec.last_seen < cutoff
        dead = not _tmux_alive(rec.tmux_name)
        if stale or dead:
            if not dead:
                _kill_tmux(rec.tmux_name)
            del _registry[session_id]


def _kill_tmux(name: str) -> None:
    try:
        subprocess.run(["tmux", "kill-session", "-t", name], capture_output=True, timeout=5)
    except (subprocess.TimeoutExpired, OSError):
        pass


def _create_tmux(session_id: str, cwd: str) -> None:
    name = _tmux_name(session_id)
    shell = os.environ.get("SHELL", "/bin/bash")
    if settings.use_login_shell:
        inner = f"cd {quote(cwd)} && exec {settings.claude_command}"
        cmd = [shell, "-lc", inner]
    else:
        cmd = [shell, "-lc", settings.claude_command]

    subprocess.run(
        ["tmux", "new-session", "-d", "-s", name, "-c", cwd, *cmd],
        check=True,
        env=os.environ.copy(),
        timeout=30,
    )


def get_session(session_id: str) -> SessionRecord | None:
    _purge_idle()
    rec = _registry.get(session_id)
    if rec is None:
        return None
    if not _tmux_alive(rec.tmux_name):
        del _registry[session_id]
        return None
    return rec


def ensure_session(cwd: str, session_id: str | None = None) -> tuple[str, bool]:
    _purge_idle()
    now = time.monotonic()

    if session_id and SESSION_ID_RE.match(session_id):
        name = _tmux_name(session_id)
        if _tmux_alive(name):
            rec = _registry.get(session_id)
            if rec is None:
                _registry[session_id] = SessionRecord(
                    session_id=session_id,
                    cwd=cwd,
                    tmux_name=name,
                    created_at=now,
                    last_seen=now,
                )
                return session_id, True
            if rec.cwd == cwd:
                rec.last_seen = now
                return session_id, True

    session_id = secrets.token_urlsafe(12)
    name = _tmux_name(session_id)
    _create_tmux(session_id, cwd)
    _registry[session_id] = SessionRecord(
        session_id=session_id,
        cwd=cwd,
        tmux_name=name,
        created_at=now,
        last_seen=now,
    )
    return session_id, False


def touch_session(session_id: str) -> None:
    rec = _registry.get(session_id)
    if rec:
        rec.last_seen = time.monotonic()


def tmux_resize(session_id: str, cols: int, rows: int) -> None:
    rec = get_session(session_id)
    if not rec:
        return
    try:
        subprocess.run(
            [
                "tmux",
                "resize-window",
                "-t",
                rec.tmux_name,
                "-x",
                str(max(cols, 10)),
                "-y",
                str(max(rows, 3)),
            ],
            capture_output=True,
            timeout=5,
        )
    except (subprocess.TimeoutExpired, OSError):
        pass
