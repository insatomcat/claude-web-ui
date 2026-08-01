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
    claude_started: bool = False


_registry: dict[str, SessionRecord] = {}


def _terminal_env() -> dict[str, str]:
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    return env


def _configure_tmux_terminal(name: str) -> None:
    for cmd in (
        ["tmux", "set-option", "-t", name, "default-terminal", "screen-256color"],
        ["tmux", "set-environment", "-t", name, "TERM", "screen-256color"],
        ["tmux", "set-option", "-t", name, "exit-empty", "on"],
    ):
        try:
            subprocess.run(cmd, capture_output=True, timeout=5)
        except (subprocess.TimeoutExpired, OSError):
            pass


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
    subprocess.run(
        ["tmux", "new-session", "-d", "-s", name, "-c", cwd],
        check=True,
        env=_terminal_env(),
        timeout=30,
    )
    _configure_tmux_terminal(name)


def mark_claude_started(session_id: str) -> None:
    rec = _registry.get(session_id)
    if rec:
        rec.claude_started = True


def should_start_claude(session_id: str) -> bool:
    rec = _registry.get(session_id)
    return rec is not None and not rec.claude_started


def claude_start_input() -> str:
    shell = os.environ.get("SHELL", "/bin/bash")
    cmd = settings.claude_command
    if settings.use_login_shell:
        return f"{shell} -lc {quote(f'exec {cmd}')}\r"
    return f"exec {cmd}\r"


def destroy_session(session_id: str) -> bool:
    rec = _registry.pop(session_id, None)
    if rec is not None:
        _kill_tmux(rec.tmux_name)
        return True
    if not SESSION_ID_RE.match(session_id):
        return False
    name = _tmux_name(session_id)
    if _tmux_alive(name):
        _kill_tmux(name)
        return True
    return False


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
                    claude_started=True,
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
