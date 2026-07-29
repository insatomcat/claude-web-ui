from datetime import datetime, timezone
from pathlib import Path

from app.config import settings


class PathNotAllowedError(Exception):
    pass


def _resolved_real(p: Path) -> Path:
    try:
        return p.resolve(strict=True)
    except OSError as e:
        raise PathNotAllowedError("Chemin introuvable") from e


def assert_path_under_roots(requested: str) -> Path:
    expanded = requested
    if requested.startswith("~"):
        expanded = str(Path.home() / requested.removeprefix("~/").removeprefix("~"))

    absolute = Path(expanded).resolve()
    try:
        real = _resolved_real(absolute)
    except PathNotAllowedError:
        raise

    for root in settings.workspace_roots:
        try:
            root_real = _resolved_real(Path(root))
        except PathNotAllowedError:
            continue
        if real == root_real or root_real in real.parents:
            return real

    raise PathNotAllowedError("Ce dossier n'est pas dans WORKSPACE_ROOTS")


def _read_git_branch(repo_path: Path) -> str | None:
    head_file = repo_path / ".git" / "HEAD"
    try:
        trimmed = head_file.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    prefix = "ref: refs/heads/"
    if trimmed.startswith(prefix):
        return trimmed[len(prefix) :]
    return trimmed[:7]


def list_subfolders(root_path: str) -> list[dict]:
    safe_root = assert_path_under_roots(root_path)
    try:
        entries = sorted(safe_root.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return []

    results: list[dict] = []
    for entry in entries:
        if entry.name.startswith("."):
            continue
        try:
            if not entry.is_dir():
                continue
        except OSError:
            continue

        is_git = (entry / ".git").exists()
        branch = _read_git_branch(entry) if is_git else None
        results.append(
            {
                "name": entry.name,
                "path": str(entry),
                "isGit": is_git,
                "branch": branch,
            }
        )
    return results


def folder_meta(folder_path: str) -> dict:
    safe = assert_path_under_roots(folder_path)
    is_git = (safe / ".git").exists()
    branch = _read_git_branch(safe) if is_git else None
    mtime: str | None = None
    try:
        mtime = datetime.fromtimestamp(safe.stat().st_mtime, tz=timezone.utc).isoformat()
    except OSError:
        pass
    return {
        "path": str(safe),
        "name": safe.name,
        "isGit": is_git,
        "branch": branch,
        "mtime": mtime,
    }
