"""Cap's voice: a serialised queue of things to say and sounds to play.

The robot has one speaker, so utterances are played one after another on a
dedicated worker thread. Long answers are synthesised sentence by sentence:
rendering a whole paragraph before the first word comes out reads as a freeze
on a Raspberry Pi.
"""

from __future__ import annotations

import logging
import queue
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from ..events import EventHub
from ..hardware.audio import Speaker
from ..hardware.tts import TextToSpeech
from ..text_utils import DEFAULT_MAX_CHARS, split_for_speech
from .sounds import ensure_sound

logger = logging.getLogger(__name__)

#: Synthesised utterances kept on disk before older ones are pruned.
RETAINED_UTTERANCES = 12


@dataclass(slots=True)
class _Item:
    """One queued thing to play."""

    utterance_id: str
    kind: str  # "speech" | "sound"
    text: str = ""
    path: Path | None = None
    chunks: list[str] = field(default_factory=list)


class SpeakService:
    """Serialises synthesis and playback on a background worker."""

    def __init__(
        self,
        tts: TextToSpeech,
        speaker: Speaker,
        events: EventHub,
        work_dir: Path,
        max_chunk_chars: int = DEFAULT_MAX_CHARS,
    ) -> None:
        self._tts = tts
        self._speaker = speaker
        self._events = events
        self._dir = work_dir
        self._max_chunk_chars = max_chunk_chars
        self._queue: queue.Queue[_Item | None] = queue.Queue()
        self._lock = threading.Lock()
        self._current: _Item | None = None
        self._stopping = threading.Event()
        self._worker: threading.Thread | None = None

    def start(self) -> None:
        """Start the playback worker."""
        if self._worker is not None:
            return
        self._worker = threading.Thread(
            target=self._run, name="capd-speak", daemon=True
        )
        self._worker.start()

    def shutdown(self) -> None:
        """Stop playback and terminate the worker."""
        self.stop()
        self._queue.put(None)
        worker = self._worker
        self._worker = None
        if worker is not None:
            worker.join(timeout=3.0)

    @property
    def active(self) -> bool:
        """Whether something is being spoken or played right now."""
        with self._lock:
            return self._current is not None

    def status(self) -> dict[str, object]:
        """Return the speaking section of the daemon status."""
        with self._lock:
            current = self._current
            return {
                "active": current is not None,
                "queue": self._queue.qsize(),
                "utterance_id": current.utterance_id if current else None,
                "engine": self._tts.name,
            }

    def speak(self, text: str, interrupt: bool = False) -> str:
        """Queue ``text`` to be spoken and return its utterance identifier."""
        chunks = split_for_speech(text, self._max_chunk_chars)
        utterance_id = f"utt_{uuid.uuid4().hex[:12]}"
        if not chunks:
            # Nothing to say: report the utterance as immediately finished so
            # callers waiting on the event are not left hanging.
            self._events.publish("speaking", state="finished", utterance_id=utterance_id)
            return utterance_id

        if interrupt:
            self.stop()
        self._queue.put(_Item(utterance_id, "speech", text=text, chunks=chunks))
        return utterance_id

    def play_sound(self, name: str, interrupt: bool = False) -> str:
        """Queue the notification sound ``name``.

        Raises:
            KeyError: if ``name`` is not a known sound.
        """
        path = ensure_sound(name, self._dir / "sounds")
        utterance_id = f"snd_{uuid.uuid4().hex[:12]}"
        if interrupt:
            self.stop()
        self._queue.put(_Item(utterance_id, "sound", text=name, path=path))
        return utterance_id

    def stop(self) -> None:
        """Drop everything queued and interrupt what is playing."""
        drained = 0
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                break
            if item is None:
                # Preserve the shutdown sentinel for the worker.
                self._queue.put(None)
                break
            drained += 1

        self._stopping.set()
        self._speaker.stop()
        if drained:
            logger.info("dropped %d queued utterance(s)", drained)

    def _run(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                return
            try:
                self._play_item(item)
            except Exception:
                logger.warning(
                    "utterance failed id=%s", item.utterance_id, exc_info=True
                )
                self._events.publish(
                    "speaking", state="failed", utterance_id=item.utterance_id
                )
            finally:
                with self._lock:
                    self._current = None

    def _play_item(self, item: _Item) -> None:
        self._stopping.clear()
        with self._lock:
            self._current = item

        self._events.publish(
            "speaking",
            state="started",
            utterance_id=item.utterance_id,
            kind=item.kind,
            text=item.text,
        )

        if item.kind == "sound":
            if item.path is not None:
                self._speaker.play(item.path)
        else:
            self._prune()
            for index, chunk in enumerate(item.chunks):
                if self._stopping.is_set():
                    break
                path = self._dir / "tts" / f"{item.utterance_id}-{index:02d}.wav"
                self._tts.synthesize(chunk, path)
                if self._stopping.is_set():
                    break
                self._speaker.play(path)

        state = "stopped" if self._stopping.is_set() else "finished"
        self._events.publish("speaking", state=state, utterance_id=item.utterance_id)

    def _prune(self) -> None:
        directory = self._dir / "tts"
        try:
            files = sorted(
                directory.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True
            )
        except OSError:
            return
        for stale in files[RETAINED_UTTERANCES:]:
            stale.unlink(missing_ok=True)
