"""Face-tracking geometry.

These assertions encode behaviour verified on the real robot: the horizontal
mirror, the letterbox removal, and the rule that the preview and the gaze must
agree about which way is up.
"""

from __future__ import annotations

import pytest

from capd.vision.geometry import (
    CENTER,
    MODEL_SIDE,
    SCREEN,
    frame_box_to_model,
    letterbox,
    model_box_to_frame,
    pick_best_box,
    to_screen,
)

FRAME_W, FRAME_H = 640, 480


def box_at(cx: float, cy: float, half: float = 0.05):
    """Return a model-space box centred on normalised frame coordinates."""
    return frame_box_to_model(
        (
            (cx - half) * FRAME_W,
            (cy - half) * FRAME_H,
            (cx + half) * FRAME_W,
            (cy + half) * FRAME_H,
        ),
        FRAME_W,
        FRAME_H,
    )


def test_letterbox_pads_only_the_short_axis() -> None:
    pad_x, pad_y, span_x, span_y = letterbox(FRAME_W, FRAME_H)

    assert pad_x == 0
    assert pad_y == pytest.approx(80)  # (640 - 480) / 2
    assert span_x == MODEL_SIDE
    assert span_y == pytest.approx(480)


def test_best_box_is_the_largest_above_the_threshold() -> None:
    boxes = [(0, 0, 10, 10), (0, 0, 40, 40), (0, 0, 100, 100)]
    scores = [0.9, 0.8, 0.2]

    # The third box is bigger but below the threshold, and detections are
    # sorted by confidence, so iteration stops before it.
    assert pick_best_box(boxes, scores, 0.45) == (0.0, 0.0, 40.0, 40.0)


def test_no_detection_above_the_threshold() -> None:
    assert pick_best_box([(0, 0, 10, 10)], [0.1], 0.45) is None
    assert pick_best_box([], [], 0.45) is None


def test_centre_of_the_frame_maps_to_the_centre_of_the_eye() -> None:
    assert to_screen(box_at(0.5, 0.5), FRAME_W, FRAME_H) == (CENTER, CENTER)


def test_horizontal_axis_is_mirrored() -> None:
    # Someone on the left of the image is on the viewer's right, and the eye
    # should look the way they moved from their own point of view.
    x_left, _ = to_screen(box_at(0.2, 0.5), FRAME_W, FRAME_H)
    x_right, _ = to_screen(box_at(0.8, 0.5), FRAME_W, FRAME_H)

    assert x_left > CENTER
    assert x_right < CENTER


def test_vertical_axis_is_not_mirrored_by_default() -> None:
    _, y_top = to_screen(box_at(0.5, 0.2), FRAME_W, FRAME_H)
    _, y_bottom = to_screen(box_at(0.5, 0.8), FRAME_W, FRAME_H)

    assert y_top < CENTER < y_bottom


def test_vflip_inverts_the_vertical_axis() -> None:
    box = box_at(0.5, 0.2)

    _, upright = to_screen(box, FRAME_W, FRAME_H, vflip=False)
    _, flipped = to_screen(box, FRAME_W, FRAME_H, vflip=True)

    assert upright < CENTER < flipped
    assert upright + flipped == pytest.approx(SCREEN, abs=1)


def test_vflip_agrees_with_the_flipped_preview() -> None:
    """The gaze and the on-screen image must not disagree about up and down.

    A face in the top of the raw frame appears at the bottom of a vertically
    flipped preview, so with the same flag the eye must look down.
    """
    box = box_at(0.5, 0.15)

    _, _, _, bottom_in_frame = model_box_to_frame(box, FRAME_W, FRAME_H)
    preview_y_after_flip = FRAME_H - bottom_in_frame
    _, eye_y = to_screen(box, FRAME_W, FRAME_H, vflip=True)

    assert preview_y_after_flip > FRAME_H / 2
    assert eye_y > CENTER


def test_coordinates_stay_inside_the_screen() -> None:
    for cx, cy in ((-2.0, -2.0), (3.0, 3.0)):
        x, y = to_screen(box_at(cx, cy), FRAME_W, FRAME_H)
        assert 0 <= x <= SCREEN
        assert 0 <= y <= SCREEN


def test_model_and_frame_conversions_round_trip() -> None:
    rect = (100.0, 60.0, 220.0, 200.0)

    box = frame_box_to_model(rect, FRAME_W, FRAME_H)
    back = model_box_to_frame(box, FRAME_W, FRAME_H)

    assert back == pytest.approx(rect, abs=1)


def test_letterbox_bars_are_removed_before_projection() -> None:
    # A box sitting in the padding belongs to no part of the real frame; it
    # must clamp instead of projecting somewhere plausible-looking.
    _, y = to_screen((300.0, 0.0, 340.0, 20.0), FRAME_W, FRAME_H)

    assert y == 0
