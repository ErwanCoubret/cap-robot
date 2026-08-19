"""Composition root of the daemon.

Everything the API needs is wired here once at startup: configuration, probed
capabilities, persisted settings, the event hub and the hardware services.
Routes receive this object and never construct adapters themselves, which is
what makes the whole daemon runnable in mock mode.
"""

from __future__ import annotations

import logging
from typing import Any

from .capabilities import Capabilities, probe
from .config import Config, load_config
from .events import EventHub
from .hardware.audio import (
    AplaySpeaker,
    ArecordMicrophone,
    Microphone,
    MockMicrophone,
    MockSpeaker,
    Speaker,
)
from .hardware.camera import FaceCamera, ImxCamera, MockCamera
from .hardware.eyes_bus import EyesBus, EyesLink, MockEyesLink, SerialEyesLink
from .hardware.tts import MockTts, SupertonicTts, TextToSpeech
from .services.recorder import RecorderService
from .services.speaker import SpeakService
from .settings_store import Settings, SettingsStore
from .vision.camera_service import CameraService
from .vision.preview import PreviewStream
from .vision.tracker import FaceTracker

logger = logging.getLogger(__name__)


def build_microphone(config: Config, capabilities: Capabilities) -> Microphone:
    """Pick the microphone adapter matching the detected hardware."""
    if capabilities.mock or not capabilities.mic:
        return MockMicrophone()
    return ArecordMicrophone(config.mic_device)


def build_speaker(config: Config, capabilities: Capabilities) -> Speaker:
    """Pick the playback adapter matching the detected hardware."""
    if capabilities.mock or not capabilities.speaker:
        return MockSpeaker()
    return AplaySpeaker(config.speaker_device)


def build_tts(config: Config, capabilities: Capabilities) -> TextToSpeech:
    """Pick the speech engine matching the detected hardware."""
    if capabilities.tts == "supertonic":
        return SupertonicTts(
            voice=config.tts_voice,
            speed=config.tts_speed,
            total_steps=config.tts_steps,
            lang=config.tts_lang,
        )
    return MockTts()


def build_camera(config: Config, capabilities: Capabilities) -> FaceCamera:
    """Pick the camera adapter matching the detected hardware."""
    if capabilities.mock or not capabilities.camera:
        return MockCamera(fps=config.camera_fps)
    return ImxCamera(config.face_model, fps=config.camera_fps)


def build_eyes_link(config: Config, capabilities: Capabilities) -> EyesLink:
    """Pick the transport to the eyes matching the detected hardware."""
    if capabilities.mock or not capabilities.eyes:
        return MockEyesLink()
    return SerialEyesLink(config.serial_port, config.serial_baud)


class Runtime:
    """Holds the daemon's long-lived collaborators."""

    def __init__(
        self,
        config: Config,
        capabilities: Capabilities,
        settings: SettingsStore,
        events: EventHub,
        recorder: RecorderService,
        speech: SpeakService,
        eyes: EyesBus | None,
        preview: PreviewStream,
        camera: CameraService,
    ) -> None:
        self.config = config
        self.capabilities = capabilities
        self.settings = settings
        self.events = events
        self.recorder = recorder
        self.speech = speech
        self.eyes = eyes
        self.preview = preview
        self.camera = camera

    @classmethod
    def build(cls, config: Config | None = None) -> "Runtime":
        """Create a runtime from ``config`` (or the environment)."""
        config = config or load_config()
        capabilities = probe(config)
        settings = SettingsStore(
            config.settings_path,
            Settings(
                vflip=config.camera_vflip,
                tracking_enabled=config.tracking_autostart,
            ),
        )
        events = EventHub()

        recorder = RecorderService(
            microphone=build_microphone(config, capabilities),
            events=events,
            recordings_dir=config.recordings_dir,
            max_seconds=config.max_record_seconds,
        )
        speech = SpeakService(
            tts=build_tts(config, capabilities),
            speaker=build_speaker(config, capabilities),
            events=events,
            work_dir=config.data_dir,
        )

        eyes: EyesBus | None = None
        try:
            eyes = EyesBus(build_eyes_link(config, capabilities))
        except Exception:
            # The port disappeared between the probe and here; face tracking is
            # disabled but the preview and everything else still work.
            logger.warning("eyes link unavailable", exc_info=True)

        preview = PreviewStream()
        camera = CameraService(
            camera_factory=lambda: build_camera(config, capabilities),
            tracker=FaceTracker(),
            preview=preview,
            events=events,
            settings=settings,
            eyes=eyes,
            available=capabilities.camera,
        )

        return cls(
            config,
            capabilities,
            settings,
            events,
            recorder,
            speech,
            eyes,
            preview,
            camera,
        )

    async def start(self) -> None:
        """Start background services. Safe to call once per process."""
        logger.info(
            "capd starting mock=%s camera=%s eyes=%s mic=%s speaker=%s tts=%s",
            self.capabilities.mock,
            self.capabilities.camera,
            self.capabilities.eyes,
            self.capabilities.mic,
            self.capabilities.speaker,
            self.capabilities.tts,
        )
        for part, reason in self.capabilities.reasons.items():
            logger.warning("capability unavailable part=%s reason=%s", part, reason)

        self.speech.start()
        if self.eyes is not None:
            self.eyes.start()
        self.camera.refresh()

    async def stop(self) -> None:
        """Stop background services and release hardware."""
        logger.info("capd stopping")
        self.recorder.shutdown()
        self.speech.shutdown()
        self.camera.shutdown()
        if self.eyes is not None:
            self.eyes.stop()

    def status(self) -> dict[str, Any]:
        """Return the full daemon status payload consumed by the UI."""
        vision = self.camera.status()
        return {
            "mock": self.capabilities.mock,
            "capabilities": self.capabilities.to_dict(),
            "camera": vision["camera"],
            "tracking": vision["tracking"],
            "eyes": self.eyes.status() if self.eyes is not None else {"available": False},
            "recording": self.recorder.status(),
            "speaking": self.speech.status(),
        }
