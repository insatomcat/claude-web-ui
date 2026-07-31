import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import subprocess
import termios

from fastapi import WebSocket

from app.tmux_sessions import get_session, tmux_resize, touch_session


def _set_winsize(fd: int, row: int, col: int) -> None:
    winsize = struct.pack("HHHH", row, col, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


async def handle_tmux_attach_ws(
    websocket: WebSocket,
    session_id: str,
    cols: int,
    rows: int,
) -> None:
    rec = get_session(session_id)
    if rec is None:
        await websocket.send_json({"type": "error", "message": "Session introuvable ou expirée"})
        return

    row = max(rows, 3)
    col = max(cols, 10)
    tmux_resize(session_id, col, row)

    master_fd, slave_fd = pty.openpty()
    _set_winsize(master_fd, row, col)

    proc = subprocess.Popen(
        ["tmux", "attach-session", "-t", rec.tmux_name],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
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
        c = max(c, 10)
        r = max(r, 3)
        _set_winsize(master_fd, r, c)
        tmux_resize(session_id, c, r)
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
                _resize(int(msg.get("cols") or col), int(msg.get("rows") or row))
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
        touch_session(session_id)
        try:
            await websocket.send_json({"type": "detached"})
        except Exception:
            pass
