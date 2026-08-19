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
from .hardware.tts import MockTts, SupertonicTts, TextToSpeech
from .services.recorder import RecorderService
from .services.speaker import SpeakService
from .settings_store import Settings, SettingsStore

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
    ) -> None:
        self.config = config
        self.capabilities = capabilities
        self.settings = settings
        self.events = events
        self.recorder = recorder
        self.speech = speech

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
        return cls(config, capabilities, settings, events, recorder, speech)

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

    async def stop(self) -> None:
        """Stop background services and release hardware."""
        logger.info("capd stopping")
        self.recorder.shutdown()
        self.speech.shutdown()

    def status(self) -> dict[str, Any]:
        """Return the full daemon status payload consumed by the UI."""
        settings = self.settings.get()
        return {
            "mock": self.capabilities.mock,
            "capabilities": self.capabilities.to_dict(),
            "camera": {
                "streaming": False,
                "vflip": settings.vflip,
                "available": self.capabilities.camera,
            },
            "tracking": {
                "active": False,
                "enabled": settings.tracking_enabled,
                "face_visible": False,
            },
            "recording": self.recorder.status(),
            "speaking": self.speech.status(),
        }
