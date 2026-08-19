"""Pure geometry of the face tracker.

Extracted from ``modules/ai-camera/face_tracker.py`` so it can be unit-tested
without a sensor. The maths here was established during bring-up on the real
hardware and is easy to get subtly wrong, so it lives in one place with tests
rather than being reimplemented.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

#: The eyes are 240x240 round GC9A01 displays.
SCREEN = 240
CENTER = SCREEN // 2

#: The IMX500 runs inference on a 640x640 square: a 640x480 frame sits between
#: two black bars, and boxes come back in absolute pixels of that square, as
#: [x0, y0, x1, y1]. picamera2's convert_inference_coords() does not apply here.
MODEL_SIDE = 640

Box = tuple[float, float, float, float]


def pick_best_box(
    boxes: Iterable[Sequence[float]],
    scores: Iterable[float],
    threshold: float,
) -> Box | None:
    """Return the largest face box above ``threshold``, or None.

    The largest box is the closest person, which is who the robot should look
    at. Detections arrive sorted by confidence, so iteration stops at the first
    one below the threshold.
    """
    best: Box | None = None
    best_area = 0.0

    for box, score in zip(boxes, scores):
        if float(score) < threshold:
            break
        x0, y0, x1, y1 = (float(value) for value in box)
        area = (x1 - x0) * (y1 - y0)
        if area > best_area:
            best_area = area
            best = (x0, y0, x1, y1)

    return best


def letterbox(frame_w: int, frame_h: int) -> tuple[float, float, float, float]:
    """Return ``(pad_x, pad_y, span_x, span_y)`` of the frame inside the square.

    The frame is centred in the model's square input, so the padding on each
    axis has to be removed before coordinates mean anything.
    """
    longest = max(frame_w, frame_h)
    pad_x = (MODEL_SIDE - frame_w * MODEL_SIDE / longest) / 2
    pad_y = (MODEL_SIDE - frame_h * MODEL_SIDE / longest) / 2
    return pad_x, pad_y, MODEL_SIDE - 2 * pad_x, MODEL_SIDE - 2 * pad_y


def to_screen(
    box: Box,
    frame_w: int,
    frame_h: int,
    vflip: bool = False,
) -> tuple[int, int]:
    """Project the centre of ``box`` onto the eye display.

    The horizontal axis is mirrored so the eye looks the same way the person
    moves from their own point of view. ``vflip`` compensates for a camera
    mounted upside down; it must be the same flag the preview uses, otherwise
    the image on screen and the direction of the gaze disagree.
    """
    x0, y0, x1, y1 = box
    pad_x, pad_y, span_x, span_y = letterbox(frame_w, frame_h)

    cx = ((x0 + x1) / 2 - pad_x) / span_x
    cy = ((y0 + y1) / 2 - pad_y) / span_y

    if vflip:
        cy = 1.0 - cy

    sx = int((1.0 - cx) * SCREEN)
    sy = int(cy * SCREEN)
    return _clamp(sx), _clamp(sy)


def model_box_to_frame(
    box: Box, frame_w: int, frame_h: int
) -> tuple[int, int, int, int]:
    """Convert a detection box into pixel coordinates of the camera frame.

    Used to draw the detection on the preview, so the user can see what the
    robot is actually locking onto while aiming the camera.
    """
    x0, y0, x1, y1 = box
    pad_x, pad_y, span_x, span_y = letterbox(frame_w, frame_h)

    left = (x0 - pad_x) / span_x * frame_w
    right = (x1 - pad_x) / span_x * frame_w
    top = (y0 - pad_y) / span_y * frame_h
    bottom = (y1 - pad_y) / span_y * frame_h

    return (
        max(0, min(frame_w, int(left))),
        max(0, min(frame_h, int(top))),
        max(0, min(frame_w, int(right))),
        max(0, min(frame_h, int(bottom))),
    )


def frame_box_to_model(
    box: tuple[float, float, float, float], frame_w: int, frame_h: int
) -> Box:
    """Convert a frame-pixel rectangle back into the model's square space."""
    left, top, right, bottom = box
    pad_x, pad_y, span_x, span_y = letterbox(frame_w, frame_h)
    return (
        pad_x + left / frame_w * span_x,
        pad_y + top / frame_h * span_y,
        pad_x + right / frame_w * span_x,
        pad_y + bottom / frame_h * span_y,
    )


def _clamp(value: int) -> int:
    return max(0, min(SCREEN, value))
