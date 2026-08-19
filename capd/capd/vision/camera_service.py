"""The single owner of the camera.

Only one process may hold the IMX500, and inside this process only this service
opens it. Two consumers are served from the one capture loop: the face tracker
(which drives the eyes) and the preview stream (which feeds the settings
screen). The sensor is opened when at least one of them needs it and released
as soon as neither does.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable

from ..events import EventHub
from ..hardware.camera import FaceCamera
from ..hardware.eyes_bus import EyesBus
from ..settings_store import SettingsStore
from .preview import PREVIEW_FPS, PreviewStream
from .tracker import FaceTracker

logger = logging.getLogger(__name__)

#: Face events are for the interface (Cap reacting to a viewer), not for
#: control, so a few per second is plenty.
FACE_EVENT_INTERVAL = 0.2


class CameraService:
    """Runs the capture loop and fans frames out to tracking and preview."""

    def __init__(
        self,
        camera_factory: Callable[[], FaceCamera],
        tracker: FaceTracker,
        preview: PreviewStream,
        events: EventHub,
        settings: SettingsStore,
        eyes: EyesBus | None = None,
        available: bool = True,
    ) -> None:
        self._camera_factory = camera_factory
        self._tracker = tracker
        self._preview = preview
        self._events = events
        self._settings = settings
        self._eyes = eyes
        self._available = available

        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._running = False
        self._face_visible = False
        self._error: str | None = None

    @property
    def available(self) -> bool:
        """Whether a camera exists on this machine."""
        return self._available

    @property
    def running(self) -> bool:
        """Whether the capture loop is currently active."""
        with self._lock:
            return self._running

    @property
    def tracking_active(self) -> bool:
        """Whether coordinates are being sent to the eyes."""
        settings = self._settings.get()
        return self.running and settings.tracking_enabled and self._eyes is not None

    def status(self) -> dict[str, object]:
        """Return the camera and tracking sections of the daemon status."""
        settings = self._settings.get()
        with self._lock:
            running = self._running
            error = self._error
            face_visible = self._face_visible
        return {
            "camera": {
                "available": self._available,
                "streaming": running,
                "vflip": settings.vflip,
                "viewers": self._preview.subscribers,
                "error": error,
            },
            "tracking": {
                "enabled": settings.tracking_enabled,
                "active": running and settings.tracking_enabled and self._eyes is not None,
                "face_visible": face_visible,
            },
        }

    def set_tracking(self, enabled: bool) -> None:
        """Turn face following on or off and persist the choice."""
        self._settings.update(tracking_enabled=enabled)
        self._events.publish("tracking", enabled=enabled, active=self.tracking_active)
        self.refresh()

    def set_vflip(self, vflip: bool) -> None:
        """Flip the camera vertically, for preview and tracking alike."""
        self._settings.update(vflip=vflip)
        self._events.publish("camera", vflip=vflip, streaming=self.running)

    def add_viewer(self) -> None:
        """Register a preview client, starting the sensor if needed."""
        self._preview.subscribe()
        self.refresh()

    def remove_viewer(self) -> None:
        """Deregister a preview client, releasing the sensor when idle."""
        self._preview.unsubscribe()
        self.refresh()

    def refresh(self) -> None:
        """Start or stop the capture loop to match what consumers need."""
        if not self._available:
            return
        if self._wanted():
            self._start()
        else:
            self._stop_loop()

    def shutdown(self) -> None:
        """Release the sensor at process exit."""
        self._stop_loop()

    def _wanted(self) -> bool:
        if self._preview.watching:
            return True
        return self._settings.get().tracking_enabled and self._eyes is not None

    def _start(self) -> None:
        with self._lock:
            if self._thread is not None:
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run, name="capd-camera", daemon=True
            )
            self._thread.start()

    def _stop_loop(self) -> None:
        with self._lock:
            thread = self._thread
            self._thread = None
        if thread is None:
            return
        self._stop.set()
        thread.join(timeout=5.0)

    def _run(self) -> None:
        camera = self._camera_factory()
        try:
            camera.open()
        except Exception as error:
            # A busy or missing sensor must not take the daemon down: report it
            # and let the rest of the robot carry on.
            logger.warning("camera could not be opened", exc_info=True)
            with self._lock:
                self._running = False
                self._error = str(error)
                self._thread = None
            self._events.publish("camera", streaming=False, error=str(error))
            return

        self._tracker.reset()
        with self._lock:
            self._running = True
            self._error = None
        self._events.publish("camera", streaming=True, vflip=self._settings.get().vflip)

        last_face_event = 0.0
        last_preview = 0.0

        try:
            while not self._stop.is_set():
                want_image = self._preview.watching
                frame = camera.capture(want_image)
                if frame is None:
                    continue

                now = time.monotonic()
                settings = self._settings.get()
                update = self._tracker.update(frame, settings.vflip, now)

                if update.point is not None and self._eyes is not None and settings.tracking_enabled:
                    self._eyes.send_tracking(*update.point)

                if update.face_visible != self._face_visible or (
                    update.face_visible and now - last_face_event > FACE_EVENT_INTERVAL
                ):
                    last_face_event = now
                    with self._lock:
                        self._face_visible = update.face_visible
                    self._events.publish(
                        "face",
                        visible=update.face_visible,
                        x=update.point[0] if update.point else None,
                        y=update.point[1] if update.point else None,
                    )

                if (
                    want_image
                    and frame.image is not None
                    and now - last_preview >= 1.0 / PREVIEW_FPS
                ):
                    last_preview = now
                    self._preview.publish(
                        frame.image, frame.width, frame.height, settings.vflip, update.box
                    )
        except Exception:
            logger.warning("capture loop failed", exc_info=True)
        finally:
            camera.close()
            with self._lock:
                self._running = False
                self._face_visible = False
                self._thread = None
            self._events.publish("camera", streaming=False)
            logger.info("camera released")
