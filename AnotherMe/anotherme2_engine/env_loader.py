"""Lightweight .env loader for the Python gateway/worker processes.

The Next.js app loads ``AnotherMe/.env.local`` automatically, but the Python
services do not. That caused the gateway worker to miss model credentials at
runtime unless the shell environment had been exported manually first.

Runtime configuration is intentionally scoped to the app/service directories:
``AnotherMe/.env.local`` for the Next.js app and shared provider credentials,
and ``AnotherMe/anotherme2_engine/api_gateway/.env`` for gateway-specific
settings.
"""

from __future__ import annotations

import os
from pathlib import Path


_ENV_LOADED = False


def _iter_candidate_files() -> list[Path]:
    base_dir = Path(__file__).resolve().parent
    api_gateway_dir = base_dir / "api_gateway"
    anotherme_dir = base_dir.parent

    # Higher-priority files come first because we only fill missing variables.
    return [
        api_gateway_dir / ".env.local",
        api_gateway_dir / ".env",
        anotherme_dir / ".env.local",
        anotherme_dir / ".env",
        base_dir / ".env.local",
        base_dir / ".env",
    ]


def _strip_wrapping_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _load_env_file(path: Path) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        lines = path.read_text(encoding="utf-8-sig").splitlines()

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        os.environ[key] = _strip_wrapping_quotes(value)


def load_project_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return

    for env_file in _iter_candidate_files():
        if env_file.exists() and env_file.is_file():
            _load_env_file(env_file)

    _ENV_LOADED = True
