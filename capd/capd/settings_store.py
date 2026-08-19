"""Runtime-mutable daemon settings, persisted to disk.

These are the knobs the user can flip from the robot's settings screen (camera
orientation, face tracking on/off). They must survive a restart, so they live in
a small JSON file rather than in memory only. Environment variables provide the
initial value the first time the file is created.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import asdict, dataclass, replace
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Settings:
    """User-controlled runtime settings."""

    vflip: bool = False
    tracking_enabled: bool = True

    def to_dict(self) -> dict[str, bool]:
        """Return a JSON-serialisable view."""
        return asdict(self)


class SettingsStore:
    """Thread-safe, disk-backed holder for :class:`Settings`.

    Writes are atomic (temporary file + ``os.replace``) so a power cut during a
    save can never leave a truncated file behind — the robot is unplugged
    casually and a corrupted settings file would break boot.
    """

    def __init__(self, path: Path, defaults: Settings) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._settings = self._load(defaults)

    def _load(self, defaults: Settings) -> Settings:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return defaults
        except (OSError, json.JSONDecodeError):
            logger.warning(
                "settings file unreadable, falling back to defaults path=%s",
                self._path,
                exc_info=True,
            )
            return defaults

        if not isinstance(raw, dict):
            return defaults
        known = {f: raw[f] for f in Settings.__dataclass_fields__ if f in raw}
        try:
            return replace(defaults, **known)
        except TypeError:
            return defaults

    def get(self) -> Settings:
        """Return the current settings snapshot."""
        with self._lock:
            return self._settings

    def update(self, **changes: bool) -> Settings:
        """Apply ``changes``, persist, and return the new snapshot.

        Unknown keys are ignored so a stale client cannot corrupt the file.
        """
        with self._lock:
            known = {
                key: value
                for key, value in changes.items()
                if key in Settings.__dataclass_fields__ and value is not None
            }
            if known:
                self._settings = replace(self._settings, **known)
                self._persist(self._settings)
            return self._settings

    def _persist(self, settings: Settings) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(f"{self._path.suffix}.tmp")
            tmp.write_text(
                json.dumps(settings.to_dict(), indent=2), encoding="utf-8"
            )
            os.replace(tmp, self._path)
        except OSError:
            logger.warning(
                "could not persist settings path=%s", self._path, exc_info=True
            )
