from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.paths import PathNotAllowedError, assert_path_under_roots, folder_meta, list_subfolders
from app.terminal import handle_terminal_ws

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"

app = FastAPI(title="Claude Web UI")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/roots")
def roots() -> dict:
    return {"roots": settings.workspace_roots}


@app.get("/api/folders")
def folders(root: str | None = Query(default=None)) -> dict:
    chosen = root or (settings.workspace_roots[0] if settings.workspace_roots else None)
    if not chosen:
        raise HTTPException(status_code=400, detail="Aucune racine configurée (WORKSPACE_ROOTS)")
    try:
        safe = assert_path_under_roots(chosen)
        return {"root": str(safe), "folders": list_subfolders(str(safe))}
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e


@app.get("/api/folder")
def folder(path: str = Query(...)) -> dict:
    try:
        return folder_meta(path)
    except PathNotAllowedError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e


@app.websocket("/ws/terminal")
async def ws_terminal(
    websocket: WebSocket,
    cwd: str = Query(...),
    cols: int = Query(80),
    rows: int = Query(24),
) -> None:
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
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")
