"""Face-following state machine driving the eyes.

Pure logic: it takes frames in and says where the pupil should point. Keeping
it free of threads and serial ports is what makes the behaviour — including
the recentre-once-then-stay-quiet rule — testable without hardware.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..hardware.camera import Frame
from .geometry import CENTER, Box, pick_best_box, to_screen

#: Minimum delay between two coordinates. The firmware smooths movement itself
#: and reads one line per render loop.
SEND_INTERVAL = 0.05

#: With no face for this long, the eye returns to centre — once.
IDLE_TIMEOUT = 1.5

#: Detection confidence below which a box is ignored.
DEFAULT_THRESHOLD = 0.45


@dataclass(frozen=True, slots=True)
class TrackingUpdate:
    """What the tracker concluded from one frame."""

    face_visible: bool
    point: tuple[int, int] | None = None
    box: Box | None = None


class FaceTracker:
    """Turns detections into eye coordinates."""

    def __init__(
        self,
        threshold: float = DEFAULT_THRESHOLD,
        send_interval: float = SEND_INTERVAL,
        idle_timeout: float = IDLE_TIMEOUT,
    ) -> None:
        self._threshold = threshold
        self._send_interval = send_interval
        self._idle_timeout = idle_timeout
        self.reset()

    def reset(self) -> None:
        """Forget past frames, as when the camera is reopened."""
        self._last_seen = 0.0
        self._last_send = 0.0
        self._last_point: tuple[int, int] | None = None
        self._centered = False

    def update(self, frame: Frame, vflip: bool, now: float) -> TrackingUpdate:
        """Consume ``frame`` and return the coordinate to send, if any."""
        box = pick_best_box(frame.boxes, frame.scores, self._threshold)

        if box is not None:
            self._last_seen = now
            self._centered = False
            point = to_screen(box, frame.width, frame.height, vflip)
        elif not self._centered and now - self._last_seen > self._idle_timeout:
            # Nobody in sight: look straight ahead once, then stop talking to
            # the eye until someone shows up again.
            point = (CENTER, CENTER)
            self._centered = True
        else:
            return TrackingUpdate(face_visible=False)

        if now - self._last_send < self._send_interval:
            return TrackingUpdate(face_visible=box is not None, box=box)

        # An unchanged coordinate is resent occasionally so the eye recovers
        # from a frame the ESP32 missed, but not on every capture.
        if point == self._last_point and now - self._last_send < self._idle_timeout:
            return TrackingUpdate(face_visible=box is not None, box=box)

        self._last_point = point
        self._last_send = now
        return TrackingUpdate(face_visible=box is not None, point=point, box=box)
