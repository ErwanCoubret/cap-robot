"""Boot-time hardware discovery.

The robot must be fully usable with pieces missing: developing on a laptop, a
camera not yet plugged in, no speaker wired up. Every capability is probed once
at startup and the result is what the UI renders, so a missing part degrades a
single feature instead of crashing the daemon.
"""

from __future__ import annotations

import importlib.util
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .config import Config

logger = logging.getLogger(__name__)

# Servos land in a follow-up PR; the slot is kept so the UI and the status
# payload do not change shape when they arrive.
SERVO_SUPPORTED = False


@dataclass(frozen=True, slots=True)
class Capabilities:
    """What this machine can actually do right now."""

    mock: bool
    camera: bool
    eyes: bool
    servo: bool
    mic: bool
    speaker: bool
    tts: str
    reasons: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serialisable view for the HTTP/WS payloads."""
        return {
            "mock": self.mock,
            "camera": self.camera,
            "eyes": self.eyes,
            "servo": self.servo,
            "mic": self.mic,
            "speaker": self.speaker,
            "tts": self.tts,
            "reasons": dict(self.reasons),
        }


def _module_available(name: str) -> bool:
    """Return True when ``name`` can be imported without importing it."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _serial_present(port: str) -> bool:
    """Return True when the ESP32 serial device exists."""
    try:
        return Path(port).exists()
    except OSError:
        return False


def probe(config: Config) -> Capabilities:
    """Detect available hardware for ``config``.

    In mock mode everything except the servo is reported as available: the
    daemon serves synthetic frames, canned audio and a silent voice so the whole
    product can be exercised off-device.
    """
    reasons: dict[str, str] = {}

    if config.mock:
        capabilities = Capabilities(
            mock=True,
            camera=True,
            eyes=True,
            servo=SERVO_SUPPORTED,
            mic=True,
            speaker=True,
            tts="mock",
            reasons={"servo": "servos are not wired up yet"},
        )
        logger.info("capabilities (mock mode): %s", capabilities.to_dict())
        return capabilities

    camera = _module_available("picamera2")
    if not camera:
        reasons["camera"] = "picamera2 is not installed"
    elif not config.face_model.exists():
        camera = False
        reasons["camera"] = f"face model missing at {config.face_model}"

    eyes = _serial_present(config.serial_port)
    if not eyes:
        reasons["eyes"] = f"no serial device at {config.serial_port}"

    mic = shutil.which("arecord") is not None
    if not mic:
        reasons["mic"] = "arecord (alsa-utils) is not installed"

    speaker = shutil.which("aplay") is not None
    if not speaker:
        reasons["speaker"] = "aplay (alsa-utils) is not installed"

    tts = "mock"
    if config.tts_engine == "supertonic":
        if _module_available("supertonic"):
            tts = "supertonic"
        else:
            reasons["tts"] = "supertonic is not installed, falling back to mock"

    if not SERVO_SUPPORTED:
        reasons["servo"] = "servos are not wired up yet"

    capabilities = Capabilities(
        mock=False,
        camera=camera,
        eyes=eyes,
        servo=SERVO_SUPPORTED,
        mic=mic,
        speaker=speaker,
        tts=tts,
        reasons=reasons,
    )
    logger.info("capabilities: %s", capabilities.to_dict())
    return capabilities
