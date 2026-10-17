"""Small durable-file primitives for the single-process demo service."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

_locks: dict[str, threading.RLock] = {}
_registry_lock = threading.Lock()


def storage_lock(path: Path) -> threading.RLock:
    with _registry_lock:
        return _locks.setdefault(str(path.resolve()), threading.RLock())


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_write_json(path: Path, value) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
