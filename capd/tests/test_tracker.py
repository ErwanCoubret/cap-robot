"""Face-following state machine."""

from __future__ import annotations

from capd.hardware.camera import Frame
from capd.vision.geometry import CENTER, frame_box_to_model
from capd.vision.tracker import FaceTracker

FRAME_W, FRAME_H = 640, 480


def frame_with_face(cx: float = 0.5, cy: float = 0.5, score: float = 0.9) -> Frame:
    box = frame_box_to_model(
        ((cx - 0.05) * FRAME_W, (cy - 0.05) * FRAME_H, (cx + 0.05) * FRAME_W, (cy + 0.05) * FRAME_H),
        FRAME_W,
        FRAME_H,
    )
    return Frame([box], [score], None, FRAME_W, FRAME_H)


def empty_frame() -> Frame:
    return Frame([], [], None, FRAME_W, FRAME_H)


def test_a_visible_face_produces_a_coordinate() -> None:
    update = FaceTracker().update(frame_with_face(), vflip=False, now=1.0)

    assert update.face_visible is True
    assert update.point == (CENTER, CENTER)


def test_low_confidence_detections_are_ignored() -> None:
    update = FaceTracker().update(frame_with_face(score=0.2), vflip=False, now=1.0)

    assert update.face_visible is False
    assert update.point is None


def test_coordinates_are_rate_limited() -> None:
    tracker = FaceTracker(send_interval=0.05)

    first = tracker.update(frame_with_face(0.3), vflip=False, now=1.0)
    too_soon = tracker.update(frame_with_face(0.7), vflip=False, now=1.02)
    later = tracker.update(frame_with_face(0.7), vflip=False, now=1.10)

    assert first.point is not None
    assert too_soon.point is None
    assert later.point is not None
    # The face is still reported as visible even when no coordinate is sent.
    assert too_soon.face_visible is True


def test_unchanged_coordinates_are_not_resent_immediately() -> None:
    tracker = FaceTracker(send_interval=0.05, idle_timeout=1.5)
    tracker.update(frame_with_face(), vflip=False, now=1.0)

    assert tracker.update(frame_with_face(), vflip=False, now=1.2).point is None
    # ...but they are refreshed eventually, so a frame the ESP32 missed is
    # recovered from.
    assert tracker.update(frame_with_face(), vflip=False, now=3.0).point is not None


def test_eye_recentres_once_when_the_face_leaves() -> None:
    tracker = FaceTracker(idle_timeout=1.0)
    tracker.update(frame_with_face(0.2), vflip=False, now=1.0)

    assert tracker.update(empty_frame(), vflip=False, now=1.5).point is None

    recentre = tracker.update(empty_frame(), vflip=False, now=2.5)
    assert recentre.point == (CENTER, CENTER)
    assert recentre.face_visible is False

    # And then it stays quiet rather than repeating the same coordinate.
    assert tracker.update(empty_frame(), vflip=False, now=4.0).point is None


def test_tracking_resumes_after_a_recentre() -> None:
    tracker = FaceTracker(idle_timeout=1.0)
    tracker.update(empty_frame(), vflip=False, now=2.0)

    update = tracker.update(frame_with_face(0.8), vflip=False, now=3.0)

    assert update.face_visible is True
    assert update.point is not None and update.point[0] < CENTER


def test_vflip_is_applied_to_the_reported_point() -> None:
    tracker = FaceTracker()
    upright = tracker.update(frame_with_face(0.5, 0.2), vflip=False, now=1.0)

    tracker.reset()
    flipped = tracker.update(frame_with_face(0.5, 0.2), vflip=True, now=1.0)

    assert upright.point is not None and flipped.point is not None
    assert upright.point[1] < CENTER < flipped.point[1]


def test_reset_forgets_history() -> None:
    tracker = FaceTracker()
    tracker.update(frame_with_face(), vflip=False, now=1.0)

    tracker.reset()

    assert tracker.update(frame_with_face(), vflip=False, now=1.0).point is not None
