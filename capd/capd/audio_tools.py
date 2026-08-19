"""Small wav helpers built on the standard library.

Used to measure recordings and to synthesise the notification sounds and the
mock voice. Generating tones at runtime keeps binary assets out of the
repository and makes the daemon self-sufficient on a fresh Pi.
"""

from __future__ import annotations

import array
import math
import os
import wave
from pathlib import Path

DEFAULT_RATE = 22050
#: Conservative amplitude: the robot's speaker is small and clipping is ugly.
DEFAULT_AMPLITUDE = 0.35

#: A tone segment: frequency in Hz (0 means silence), duration in seconds and
#: relative amplitude.
Segment = tuple[float, float, float]


def wav_duration(path: Path) -> float:
    """Return the duration of a wav file in seconds (0.0 when unreadable)."""
    try:
        with wave.open(str(path), "rb") as handle:
            rate = handle.getframerate()
            if rate <= 0:
                return 0.0
            return handle.getnframes() / float(rate)
    except (OSError, wave.Error):
        return 0.0


def _render(segments: list[Segment], rate: int) -> array.array:
    samples = array.array("h")
    for frequency, duration, amplitude in segments:
        count = max(0, int(duration * rate))
        if frequency <= 0:
            samples.extend([0] * count)
            continue
        peak = amplitude * 32767
        for index in range(count):
            # Short linear fades avoid the click a hard tone edge produces.
            fade = min(1.0, index / (0.01 * rate + 1), (count - index) / (0.01 * rate + 1))
            value = peak * fade * math.sin(2 * math.pi * frequency * index / rate)
            samples.append(int(max(-32768, min(32767, value))))
    return samples


def write_wav(path: Path, segments: list[Segment], rate: int = DEFAULT_RATE) -> Path:
    """Write ``segments`` to ``path`` as a mono 16-bit wav, atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = _render(segments, rate)

    tmp = path.with_suffix(f"{path.suffix}.tmp")
    with wave.open(str(tmp), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())
    os.replace(tmp, path)
    return path


def write_silence(path: Path, seconds: float, rate: int = DEFAULT_RATE) -> Path:
    """Write ``seconds`` of silence to ``path``."""
    return write_wav(path, [(0.0, max(0.0, seconds), 0.0)], rate=rate)
