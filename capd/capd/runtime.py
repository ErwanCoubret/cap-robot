"""Composition root of the daemon.

Everything the API needs is wired here once at startup: configuration, probed
capabilities, persisted settings, the event hub and (as later phases land) the
hardware services. Routes receive this object and never construct adapters
themselves, which is what makes the whole daemon runnable in mock mode.
"""

from __future__ import annotations

import logging
from typing import Any

from .capabilities import Capabilities, probe
from .config import Config, load_config
from .events import EventHub
from .settings_store import Settings, SettingsStore

logger = logging.getLogger(__name__)


class Runtime:
    """Holds the daemon's long-lived collaborators."""

    def __init__(
        self,
        config: Config,
        capabilities: Capabilities,
        settings: SettingsStore,
        events: EventHub,
    ) -> None:
        self.config = config
        self.capabilities = capabilities
        self.settings = settings
        self.events = events

    @classmethod
    def build(cls, config: Config | None = None) -> "Runtime":
        """Create a runtime from ``config`` (or the environment)."""
        config = config or load_config()
        capabilities = probe(config)
        settings = SettingsStore(
            config.settings_path,
            Settings(vflip=config.camera_vflip, tracking_enabled=config.tracking_autostart),
        )
        return cls(config, capabilities, settings, EventHub())

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

    async def stop(self) -> None:
        """Stop background services and release hardware."""
        logger.info("capd stopping")

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
            "recording": {"active": False},
            "speaking": {"active": False, "queue": 0},
        }
