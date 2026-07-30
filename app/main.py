from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings, _normalize_root_path
from app.paths import PathNotAllowedError, assert_path_under_roots, folder_meta, list_subfolders
from app.terminal import handle_terminal_ws
from app.ws_tokens import client_ip_from_headers, consume_ws_token, issue_ws_token

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
INDEX_HTML = STATIC / "index.html"


def public_base_path(request: Request) -> str:
    header = request.headers.get("x-forwarded-prefix", "").strip()
    if header:
        return _normalize_root_path(header)
    return settings.root_path


api = FastAPI(title="Claude Web UI")


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
def ws_token(request: Request) -> dict:
    ip = client_ip_from_headers(
        request.headers.get("x-forwarded-for"),
        request.client.host if request.client else None,
    )
    return {"token": issue_ws_token(ip)}


@api.get("/api/folder")
def folder(path: str = Query(...)) -> dict:
    try:
        return folder_meta(path)
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e


@api.websocket("/ws/terminal")
async def ws_terminal(
    websocket: WebSocket,
    cwd: str = Query(...),
    cols: int = Query(80),
    rows: int = Query(24),
    token: str | None = Query(default=None),
) -> None:
    ip = client_ip_from_headers(
        websocket.headers.get("x-forwarded-for"),
        websocket.client.host if websocket.client else None,
    )
    if not consume_ws_token(token, ip):
        await websocket.close(code=4401, reason="Jeton WS invalide ou expiré")
        return

    await websocket.accept()
    if not cwd:
        await websocket.send_json({"type": "error", "message": "cwd manquant"})
        await websocket.close()
        return
    try:
        safe = assert_path_under_roots(cwd)
    except PathNotAllowedError as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return

    await websocket.send_json(
        {
            "type": "ready",
            "cwd": str(safe),
            "command": settings.claude_command,
        }
    )
    try:
        await handle_terminal_ws(
            websocket,
            str(safe),
            cols,
            rows,
            settings.claude_command,
            settings.use_login_shell,
        )
    except WebSocketDisconnect:
        pass


if STATIC.is_dir():
    api.mount("/static", StaticFiles(directory=STATIC), name="static")

    @api.get("/")
    def index(request: Request) -> HTMLResponse:
        html = INDEX_HTML.read_text(encoding="utf-8")
        base = public_base_path(request)
        base_href = f"{base}/" if base else "/"
        html = html.replace('%%APP_BASE_HREF%%', base_href)
        html = html.replace('%%APP_BASE_PATH%%', base)
        return HTMLResponse(html)


def create_app() -> FastAPI:
    prefix = settings.root_path
    if not prefix or not settings.mount_at_root_path:
        return api
    root = FastAPI()
    root.mount(prefix, api)
    return root


app = create_app()
