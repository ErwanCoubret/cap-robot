"""Voice capture lifecycle.

One recording at a time, always bounded in length: the robot has a single
microphone and a finite SD card, and a capture left running by a missed tap
would quietly fill both.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..audio_tools import wav_duration
from ..events import EventHub
from ..hardware.audio import Microphone

logger = logging.getLogger(__name__)

#: Recordings kept on disk; older ones are pruned when a new capture starts.
RETAINED_RECORDINGS = 20


class RecorderError(RuntimeError):
    """Raised when a recording command does not apply to the current state."""


@dataclass(frozen=True, slots=True)
class Recording:
    """A finished capture."""

    recording_id: str
    path: Path
    duration_s: float

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serialisable view."""
        return {
            "recording_id": self.recording_id,
            "path": str(self.path),
            "duration_s": round(self.duration_s, 3),
        }


class RecorderService:
    """Drives the microphone and tracks what was captured."""

    def __init__(
        self,
        microphone: Microphone,
        events: EventHub,
        recordings_dir: Path,
        max_seconds: int,
    ) -> None:
        self._microphone = microphone
        self._events = events
        self._dir = recordings_dir
        self._max_seconds = max_seconds
        self._lock = threading.RLock()
        self._recording_id: str | None = None
        self._path: Path | None = None
        self._started_at: float | None = None
        self._watchdog: threading.Timer | None = None

    @property
    def active(self) -> bool:
        """Whether a capture is in progress."""
        with self._lock:
            return self._recording_id is not None

    def status(self) -> dict[str, object]:
        """Return the recording section of the daemon status."""
        with self._lock:
            if self._recording_id is None or self._started_at is None:
                return {"active": False}
            return {
                "active": True,
                "recording_id": self._recording_id,
                "elapsed_s": round(time.monotonic() - self._started_at, 2),
            }

    def start(self, max_seconds: int | None = None) -> str:
        """Begin a capture and return its identifier."""
        with self._lock:
            if self._recording_id is not None:
                raise RecorderError("a recording is already in progress")

            limit = max(1, min(max_seconds or self._max_seconds, self._max_seconds))
            recording_id = f"rec_{uuid.uuid4().hex[:12]}"
            path = self._dir / f"{recording_id}.wav"

            self._prune()
            self._microphone.start(path)
            self._recording_id = recording_id
            self._path = path
            self._started_at = time.monotonic()
            self._watchdog = threading.Timer(limit, self._on_timeout, args=(recording_id,))
            self._watchdog.daemon = True
            self._watchdog.start()

        self._events.publish("recording", state="started", recording_id=recording_id)
        logger.info("recording started id=%s limit=%ss", recording_id, limit)
        return recording_id

    def stop(self) -> Recording:
        """Finish the capture and return the resulting file."""
        with self._lock:
            if self._recording_id is None or self._path is None:
                raise RecorderError("no recording in progress")
            recording_id = self._recording_id
            path = self._path
            self._cancel_watchdog()
            self._microphone.stop()
            self._recording_id = None
            self._path = None
            self._started_at = None

        recording = Recording(recording_id, path, wav_duration(path))
        self._events.publish(
            "recording",
            state="stopped",
            recording_id=recording_id,
            duration_s=recording.duration_s,
        )
        logger.info(
            "recording stopped id=%s duration=%.2fs", recording_id, recording.duration_s
        )
        return recording

    def cancel(self) -> None:
        """Abort the capture and delete the partial file."""
        with self._lock:
            recording_id = self._recording_id
            if recording_id is None:
                return
            self._cancel_watchdog()
            self._microphone.abort()
            self._recording_id = None
            self._path = None
            self._started_at = None

        self._events.publish("recording", state="cancelled", recording_id=recording_id)
        logger.info("recording cancelled id=%s", recording_id)

    def path_for(self, recording_id: str) -> Path | None:
        """Return the wav file of a finished capture, when it still exists."""
        # Identifiers are generated here and are hex-only, so a client cannot
        # walk out of the recordings directory with a crafted value.
        if not recording_id.startswith("rec_") or not recording_id[4:].isalnum():
            return None
        path = self._dir / f"{recording_id}.wav"
        return path if path.exists() else None

    def shutdown(self) -> None:
        """Abort any capture still running at process exit."""
        self.cancel()

    def _on_timeout(self, recording_id: str) -> None:
        with self._lock:
            if self._recording_id != recording_id:
                return
        logger.info("recording hit its time limit id=%s", recording_id)
        try:
            self.stop()
        except RecorderError:
            pass

    def _cancel_watchdog(self) -> None:
        if self._watchdog is not None:
            self._watchdog.cancel()
            self._watchdog = None

    def _prune(self) -> None:
        try:
            files = sorted(
                self._dir.glob("rec_*.wav"), key=lambda p: p.stat().st_mtime, reverse=True
            )
        except OSError:
            return
        for stale in files[RETAINED_RECORDINGS:]:
            stale.unlink(missing_ok=True)
