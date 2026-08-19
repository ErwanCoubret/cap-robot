"""Text-to-speech engines.

Speech is always synthesised locally: Cap must keep its voice with no network,
and the transcript of what the user says never needs to leave the robot for the
answer to be spoken.
"""

from __future__ import annotations

import logging
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from ..audio_tools import write_wav

logger = logging.getLogger(__name__)

#: Rough French speaking rate, used to size the mock voice realistically.
MOCK_CHARS_PER_SECOND = 14.0
MOCK_MIN_SECONDS = 0.6
MOCK_MAX_SECONDS = 20.0


class TextToSpeech(ABC):
    """Turns text into a playable wav file."""

    #: Engine name surfaced in the status payload.
    name: str = "unknown"

    @abstractmethod
    def synthesize(self, text: str, destination: Path) -> Path:
        """Render ``text`` into ``destination`` and return the path."""

    def warm_up(self) -> None:
        """Optionally pre-load models so the first utterance is not slow."""


class SupertonicTts(TextToSpeech):
    """Supertonic, running on-device through ONNX Runtime.

    The model weighs a few hundred megabytes and is fetched on first use, so it
    is loaded lazily and guarded by a lock: two concurrent utterances must not
    trigger two downloads.
    """

    name = "supertonic"

    def __init__(
        self,
        voice: str = "M1",
        speed: float = 1.05,
        total_steps: int = 8,
        lang: str = "fr",
        model: str = "supertonic-3",
    ) -> None:
        self._voice = voice
        self._speed = speed
        self._total_steps = total_steps
        self._lang = lang
        self._model = model
        self._lock = threading.Lock()
        self._tts: Any | None = None
        self._voice_style: Any | None = None

    def _ensure_loaded(self) -> Any:
        with self._lock:
            if self._tts is None:
                from supertonic import TTS  # imported lazily: heavy dependency

                logger.info(
                    "loading supertonic model=%s voice=%s", self._model, self._voice
                )
                self._tts = TTS(model=self._model, auto_download=True)
                self._voice_style = self._tts.get_voice_style(voice_name=self._voice)
            return self._tts

    def warm_up(self) -> None:
        """Load the model up front so the first spoken reply is not delayed."""
        try:
            self._ensure_loaded()
        except Exception:
            logger.warning("supertonic warm-up failed", exc_info=True)

    def synthesize(self, text: str, destination: Path) -> Path:
        import soundfile

        tts = self._ensure_loaded()
        wav, _duration = tts.synthesize(
            text,
            voice_style=self._voice_style,
            total_steps=self._total_steps,
            speed=self._speed,
            lang=self._lang,
            verbose=False,
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        soundfile.write(
            str(destination),
            wav.squeeze(),
            tts.sample_rate,
            format="WAV",
            subtype="PCM_16",
        )
        return destination


class MockTts(TextToSpeech):
    """Renders a hum whose length matches how long the sentence would take."""

    name = "mock"

    def __init__(self) -> None:
        self.spoken: list[str] = []

    def synthesize(self, text: str, destination: Path) -> Path:
        self.spoken.append(text)
        seconds = min(
            MOCK_MAX_SECONDS,
            max(MOCK_MIN_SECONDS, len(text) / MOCK_CHARS_PER_SECOND),
        )
        # A gently modulated pair of tones is easier to recognise as "Cap is
        # talking" than flat silence when testing with the speaker connected.
        third = seconds / 3
        return write_wav(
            destination,
            [
                (240.0, third, 0.25),
                (300.0, third, 0.22),
                (220.0, seconds - 2 * third, 0.25),
            ],
        )
