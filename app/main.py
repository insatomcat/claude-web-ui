from pathlib import Path
import subprocess

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import settings, _normalize_root_path
from app.paths import PathNotAllowedError, assert_path_under_roots, folder_meta, list_subfolders
from app.terminal import handle_tmux_attach_ws
from app.tmux_sessions import destroy_session, ensure_session, get_session
from app.ws_tokens import consume_ws_token, issue_ws_token

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
INDEX_HTML = STATIC / "index.html"


def public_base_path(request: Request) -> str:
    header = request.headers.get("x-forwarded-prefix", "").strip()
    if header:
        return _normalize_root_path(header)
    return settings.root_path


api = FastAPI(title="Claude Web UI")


class SessionCreateBody(BaseModel):
    cwd: str
    sessionId: str | None = None


@api.get("/api/health")
def health() -> dict:
    return {"ok": True}


@api.get("/api/config")
def app_config(request: Request) -> dict:
    return {"basePath": public_base_path(request)}


@api.get("/api/roots")
def roots() -> dict:
    return {"roots": settings.workspace_roots}


@api.get("/api/folders")
def folders(root: str | None = Query(default=None)) -> dict:
    chosen = root or (settings.workspace_roots[0] if settings.workspace_roots else None)
    if not chosen:
        raise HTTPException(status_code=400, detail="Aucune racine configurée (WORKSPACE_ROOTS)")
    try:
        safe = assert_path_under_roots(chosen)
        return {"root": str(safe), "folders": list_subfolders(str(safe))}
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e


@api.get("/api/ws-token")
def ws_token() -> dict:
    return {"token": issue_ws_token()}


@api.post("/api/sessions")
def create_session(body: SessionCreateBody) -> dict:
    try:
        safe = assert_path_under_roots(body.cwd)
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    try:
        session_id, resumed = ensure_session(str(safe), body.sessionId)
    except (subprocess.CalledProcessError, OSError) as e:
        raise HTTPException(status_code=500, detail=f"tmux indisponible ou échec session: {e}") from e
    return {
        "sessionId": session_id,
        "cwd": str(safe),
        "resumed": resumed,
    }


@api.get("/api/sessions/{session_id}")
def session_status(session_id: str) -> dict:
    rec = get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session introuvable")
    return {"sessionId": rec.session_id, "cwd": rec.cwd, "alive": True}


@api.delete("/api/sessions/{session_id}")
def delete_session(session_id: str) -> dict:
    if destroy_session(session_id):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Session introuvable")


@api.get("/api/folder")
def folder(path: str = Query(...)) -> dict:
    try:
        return folder_meta(path)
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e


@api.websocket("/ws/terminal")
async def ws_terminal(
    websocket: WebSocket,
    sessionId: str = Query(...),
    cols: int = Query(80),
    rows: int = Query(24),
    token: str | None = Query(default=None),
) -> None:
    if not consume_ws_token(token):
        await websocket.close(code=4401, reason="Jeton WS invalide ou expiré")
        return

    rec = get_session(sessionId)
    if rec is None:
        await websocket.close(code=4404, reason="Session introuvable")
        return

    await websocket.accept()
    await websocket.send_json(
        {
            "type": "ready",
            "cwd": rec.cwd,
            "sessionId": rec.session_id,
            "command": settings.claude_command,
            "resumed": True,
        }
    )
    try:
        await handle_tmux_attach_ws(websocket, sessionId, cols, rows)
    except WebSocketDisconnect:
        pass


if STATIC.is_dir():
    api.mount("/static", StaticFiles(directory=STATIC), name="static")

    @api.get("/")
    def index(request: Request) -> HTMLResponse:
        html = INDEX_HTML.read_text(encoding="utf-8")
        base = public_base_path(request)
        base_href = f"{base}/" if base else "/"
        html = html.replace("%%APP_BASE_HREF%%", base_href)
        html = html.replace("%%APP_BASE_PATH%%", base)
        return HTMLResponse(html)


def create_app() -> FastAPI:
    prefix = settings.root_path
    if not prefix or not settings.mount_at_root_path:
        return api
    root = FastAPI()
    root.mount(prefix, api)
    return root


app = create_app()
