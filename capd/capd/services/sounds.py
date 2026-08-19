"""Notification sounds.

Generated on first use rather than shipped as binary assets: the tones are a
few lines of arithmetic, and keeping wav blobs out of the repository means a
fresh Pi needs nothing extra to make a sound.
"""

from __future__ import annotations

from pathlib import Path

from ..audio_tools import Segment, write_wav

#: name -> tone segments (frequency Hz, duration s, amplitude).
SOUNDS: dict[str, list[Segment]] = {
    # Rising two-note motif: something finished, nothing needs attention.
    "chime": [(784.0, 0.12, 0.32), (0.0, 0.03, 0.0), (1047.0, 0.22, 0.30)],
    # Repeated mid-tone: an alarm is ringing and expects a tap.
    "alert": [
        (880.0, 0.18, 0.38),
        (0.0, 0.08, 0.0),
        (880.0, 0.18, 0.38),
        (0.0, 0.08, 0.0),
        (880.0, 0.26, 0.38),
    ],
    # Falling pair: something went wrong.
    "error": [(392.0, 0.16, 0.30), (0.0, 0.04, 0.0), (294.0, 0.30, 0.30)],
    # Short blip acknowledging that the microphone is now listening.
    "listening": [(523.0, 0.10, 0.28), (0.0, 0.02, 0.0), (659.0, 0.12, 0.26)],
}


def available_sounds() -> list[str]:
    """Return the names that :func:`ensure_sound` accepts."""
    return sorted(SOUNDS)


def ensure_sound(name: str, directory: Path) -> Path:
    """Return the wav for ``name``, generating it on first use.

    Raises:
        KeyError: if ``name`` is not a known sound.
    """
    segments = SOUNDS[name]
    path = directory / f"{name}.wav"
    if not path.exists():
        write_wav(path, segments)
    return path
