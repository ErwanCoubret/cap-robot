"""Camera adapters.

The IMX500 runs face detection on the sensor itself and only one process may
hold it, so this adapter is opened exactly once, by the camera service.
"""

from __future__ import annotations

import logging
import math
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..vision.geometry import frame_box_to_model

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Frame:
    """One captured frame: detections, and the image when it was requested."""

    boxes: list[Any] = field(default_factory=list)
    scores: list[float] = field(default_factory=list)
    image: Any | None = None
    width: int = 0
    height: int = 0


class FaceCamera(ABC):
    """A camera producing face detections and, on demand, images."""

    @abstractmethod
    def open(self) -> None:
        """Acquire the sensor."""

    @abstractmethod
    def close(self) -> None:
        """Release the sensor so another owner could take it."""

    @abstractmethod
    def capture(self, want_image: bool) -> Frame | None:
        """Block until the next frame and return it."""


class ImxCamera(FaceCamera):
    """Raspberry Pi AI Camera (Sony IMX500) running YOLOv8n-face on-sensor."""

    def __init__(self, model: Path, fps: int = 15) -> None:
        self._model = model
        self._fps = fps
        self._imx500: Any | None = None
        self._picam: Any | None = None
        self._size = (640, 480)

    def open(self) -> None:
        from picamera2 import Picamera2
        from picamera2.devices import IMX500

        logger.info("opening IMX500 model=%s fps=%s", self._model, self._fps)
        self._imx500 = IMX500(str(self._model))
        self._picam = Picamera2(self._imx500.camera_num)
        self._picam.configure(
            self._picam.create_preview_configuration(
                controls={"FrameRate": self._fps}, buffer_count=8
            )
        )
        # The first start uploads a few megabytes of network firmware.
        self._imx500.show_network_fw_progress_bar()
        self._picam.start()
        self._size = tuple(self._picam.camera_configuration()["main"]["size"])
        logger.info("camera running size=%sx%s", *self._size)

    def close(self) -> None:
        if self._picam is not None:
            try:
                self._picam.stop()
                self._picam.close()
            except Exception:
                logger.warning("closing the camera failed", exc_info=True)
        self._picam = None
        self._imx500 = None

    def capture(self, want_image: bool) -> Frame | None:
        if self._picam is None or self._imx500 is None:
            return None

        # One request carries both the inference metadata and the pixels, so
        # detections and the preview image always describe the same instant.
        request = self._picam.capture_request()
        try:
            metadata = request.get_metadata()
            outputs = self._imx500.get_outputs(metadata, add_batch=True)
            boxes: list[Any] = []
            scores: list[float] = []
            if outputs is not None:
                boxes, scores = outputs[0][0], outputs[1][0]
            image = request.make_array("main") if want_image else None
        finally:
            request.release()

        return Frame(boxes, scores, image, self._size[0], self._size[1])


class MockCamera(FaceCamera):
    """A synthetic face orbiting the frame, with a matching rendered image.

    Motion is deliberate: it makes the preview, the tracking coordinates and
    the idle-recentre logic all observable without a sensor.
    """

    def __init__(self, size: tuple[int, int] = (640, 480), fps: int = 15) -> None:
        self._size = size
        self._fps = fps
        self._opened = False
        self._numpy: Any | None = None

    def open(self) -> None:
        import numpy

        self._numpy = numpy
        self._opened = True
        logger.info("opening mock camera size=%sx%s", *self._size)

    def close(self) -> None:
        self._opened = False

    def face_visible(self, now: float | None = None) -> bool:
        """Whether a face is present at ``now``.

        The face disappears for a few seconds every cycle so the idle path —
        recentring the eye and reporting "no face" — is exercised too.
        """
        moment = time.monotonic() if now is None else now
        return (moment % 20.0) < 15.0

    def capture(self, want_image: bool) -> Frame | None:
        if not self._opened or self._numpy is None:
            return None

        time.sleep(1.0 / max(1, self._fps))
        now = time.monotonic()
        width, height = self._size

        if not self.face_visible(now):
            image = self._render(None, want_image)
            return Frame([], [], image, width, height)

        # A head-sized box drifting horizontally and bobbing slightly.
        cx = 0.5 + 0.28 * math.sin(now * 0.6)
        cy = 0.45 + 0.10 * math.sin(now * 0.9)
        half_w, half_h = 0.09, 0.13
        rect = (
            (cx - half_w) * width,
            (cy - half_h) * height,
            (cx + half_w) * width,
            (cy + half_h) * height,
        )
        box = frame_box_to_model(rect, width, height)
        image = self._render(rect, want_image)
        return Frame([box], [0.82], image, width, height)

    def _render(self, rect: tuple[float, float, float, float] | None, want_image: bool):
        if not want_image or self._numpy is None:
            return None

        numpy = self._numpy
        width, height = self._size
        # A vertical gradient makes the vertical flip obvious at a glance.
        column = numpy.linspace(40, 150, height, dtype=numpy.uint8)
        image = numpy.repeat(column[:, None], width, axis=1)
        image = numpy.stack([image, image // 2 + 30, numpy.full_like(image, 90)], axis=2)

        if rect is not None:
            left, top, right, bottom = (int(value) for value in rect)
            left, top = max(0, left), max(0, top)
            right, bottom = min(width, right), min(height, bottom)
            if right > left and bottom > top:
                image[top:bottom, left:right] = (235, 205, 180)
        return image
