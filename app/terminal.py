import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import termios
from shlex import quote

from fastapi import WebSocket


def _set_winsize(fd: int, row: int, col: int) -> None:
    winsize = struct.pack("HHHH", row, col, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def _shell_command(cwd: str, claude_command: str, use_login_shell: bool) -> list[str]:
    shell = os.environ.get("SHELL", "/bin/bash")
    if use_login_shell:
        script = f"cd {quote(cwd)} && exec {claude_command}"
        return [shell, "-lc", script]
    return [shell, "-lc", claude_command]


async def handle_terminal_ws(
    websocket: WebSocket,
    cwd: str,
    cols: int,
    rows: int,
    claude_command: str,
    use_login_shell: bool,
) -> None:
    master_fd, slave_fd = pty.openpty()
    row = max(rows, 3)
    col = max(cols, 10)
    _set_winsize(master_fd, row, col)

    cmd = _shell_command(cwd, claude_command, use_login_shell)
    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=cwd,
        close_fds=True,
        start_new_session=True,
        env=os.environ.copy(),
    )
    os.close(slave_fd)

    stop = asyncio.Event()

    async def read_pty() -> None:
        while not stop.is_set():
            try:
                data = await asyncio.to_thread(os.read, master_fd, 4096)
            except OSError:
                break
            if not data:
                break
            text = data.decode("utf-8", errors="replace")
            await websocket.send_json({"type": "output", "data": text})

    reader = asyncio.create_task(read_pty())

    def _resize(c: int, r: int) -> None:
        _set_winsize(master_fd, max(r, 3), max(c, 10))
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGWINCH)
        except (ProcessLookupError, OSError):
            pass

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")
            if msg_type == "input" and isinstance(msg.get("data"), str):
                os.write(master_fd, msg["data"].encode("utf-8"))
            elif msg_type == "resize":
                c = int(msg.get("cols") or col)
                r = int(msg.get("rows") or row)
                _resize(c, r)
    except asyncio.CancelledError:
        raise
    finally:
        stop.set()
        reader.cancel()
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            await websocket.send_json({"type": "exit"})
        except Exception:
            pass
