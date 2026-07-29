import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _expand_home(p: str) -> str:
    if p.startswith("~/"):
        return str(Path.home() / p[2:])
    if p == "~":
        return str(Path.home())
    return p


def _normalize_root_path(raw: str) -> str:
    value = raw.strip().rstrip("/")
    if not value:
        return ""
    return value if value.startswith("/") else f"/{value}"


class Settings:
    port: int = int(os.getenv("PORT", "3847"))
    host: str = os.getenv("HOST", "127.0.0.1")
    claude_command: str = os.getenv("CLAUDE_COMMAND", "claude")
    use_login_shell: bool = os.getenv("USE_LOGIN_SHELL", "true").lower() != "false"
    root_path: str = _normalize_root_path(os.getenv("ROOT_PATH", ""))
    mount_at_root_path: bool = os.getenv("MOUNT_AT_ROOT_PATH", "false").lower() == "true"
    workspace_roots: list[str]

    def __init__(self) -> None:
        raw = os.getenv("WORKSPACE_ROOTS", str(Path.home() / "dev"))
        self.workspace_roots = [
            _expand_home(part.strip()) for part in raw.split(",") if part.strip()
        ]


settings = Settings()
