"""The camera preview shown in the robot's settings screen.

Frames are encoded only while somebody is watching: the sensor is a shared,
single-owner resource and the Pi has better things to do than compress JPEGs
nobody looks at.
"""

from __future__ import annotations

import io
import logging
import threading
from typing import Any

from .geometry import Box, model_box_to_frame

logger = logging.getLogger(__name__)

#: Small enough to stay cheap on the Pi, large enough to aim the camera by.
PREVIEW_WIDTH = 320
PREVIEW_HEIGHT = 240
JPEG_QUALITY = 70

#: Preview refresh rate. The sensor runs faster for tracking; the picture does
#: not need to.
PREVIEW_FPS = 8

#: Detection overlay drawn in the Flots brand purple.
BOX_COLOR = (97, 95, 255)


class PreviewStream:
    """Holds the most recent encoded frame and counts who is watching."""

    def __init__(
        self,
        width: int = PREVIEW_WIDTH,
        height: int = PREVIEW_HEIGHT,
        quality: int = JPEG_QUALITY,
    ) -> None:
        self._width = width
        self._height = height
        self._quality = quality
        self._lock = threading.Lock()
        self._subscribers = 0
        self._jpeg: bytes | None = None
        self._revision = 0

    @property
    def watching(self) -> bool:
        """Whether at least one client is consuming the stream."""
        with self._lock:
            return self._subscribers > 0

    @property
    def subscribers(self) -> int:
        """Number of connected preview clients."""
        with self._lock:
            return self._subscribers

    def subscribe(self) -> None:
        """Register a viewer."""
        with self._lock:
            self._subscribers += 1

    def unsubscribe(self) -> None:
        """Deregister a viewer, dropping the cached frame when the last leaves."""
        with self._lock:
            self._subscribers = max(0, self._subscribers - 1)
            if self._subscribers == 0:
                self._jpeg = None

    def latest(self) -> tuple[int, bytes | None]:
        """Return ``(revision, jpeg)``; the revision changes on every frame."""
        with self._lock:
            return self._revision, self._jpeg

    def publish(
        self,
        image: Any,
        frame_w: int,
        frame_h: int,
        vflip: bool,
        box: Box | None = None,
    ) -> None:
        """Encode ``image`` and make it the current frame."""
        jpeg = self._encode(image, frame_w, frame_h, vflip, box)
        if jpeg is None:
            return
        with self._lock:
            self._jpeg = jpeg
            self._revision += 1

    def _encode(
        self,
        image: Any,
        frame_w: int,
        frame_h: int,
        vflip: bool,
        box: Box | None,
    ) -> bytes | None:
        try:
            from PIL import Image, ImageDraw

            picture = Image.fromarray(image).convert("RGB")

            if box is not None:
                # Drawn before flipping, while the box is still expressed in
                # the raw frame's coordinates.
                left, top, right, bottom = model_box_to_frame(box, frame_w, frame_h)
                ImageDraw.Draw(picture).rectangle(
                    ((left, top), (right, bottom)), outline=BOX_COLOR, width=4
                )

            if vflip:
                picture = picture.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

            picture = picture.resize((self._width, self._height))
            buffer = io.BytesIO()
            picture.save(buffer, format="JPEG", quality=self._quality)
            return buffer.getvalue()
        except Exception:
            logger.warning("preview encoding failed", exc_info=True)
            return None
