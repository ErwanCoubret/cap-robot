"""Camera ownership and the preview fan-out."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from capd.events import EventHub
from capd.hardware.camera import MockCamera
from capd.hardware.eyes_bus import EyesBus, MockEyesLink
from capd.settings_store import Settings, SettingsStore
from capd.vision.camera_service import CameraService
from capd.vision.preview import PreviewStream
from capd.vision.tracker import FaceTracker


class CountingCamera(MockCamera):
    """Mock camera counting how many times the sensor was acquired."""

    opens = 0

    def open(self) -> None:
        super().open()
        type(self).opens += 1

    def face_visible(self, now: float | None = None) -> bool:
        # Always in view: these tests are about the loop, not the idle path.
        return True


@pytest.fixture(autouse=True)
def reset_counter() -> None:
    CountingCamera.opens = 0


@pytest.fixture
def settings(tmp_path: Path) -> SettingsStore:
    return SettingsStore(tmp_path / "settings.json", Settings(tracking_enabled=False))


def build(settings: SettingsStore, with_eyes: bool = True) -> tuple[CameraService, MockEyesLink, PreviewStream]:
    link = MockEyesLink()
    eyes = EyesBus(link, min_interval=0.01)
    eyes.start()
    preview = PreviewStream()
    service = CameraService(
        camera_factory=CountingCamera,
        tracker=FaceTracker(),
        preview=preview,
        events=EventHub(),
        settings=settings,
        eyes=eyes if with_eyes else None,
    )
    return service, link, preview


def wait_until(predicate, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_sensor_stays_closed_while_nobody_needs_it(settings: SettingsStore) -> None:
    service, _, _ = build(settings)
    try:
        service.refresh()
        time.sleep(0.2)

        assert service.running is False
        assert CountingCamera.opens == 0
    finally:
        service.shutdown()


def test_a_preview_viewer_starts_and_releases_the_sensor(settings: SettingsStore) -> None:
    service, _, preview = build(settings)
    try:
        service.add_viewer()
        assert wait_until(lambda: preview.latest()[1] is not None)
        assert service.running is True

        service.remove_viewer()
        assert wait_until(lambda: not service.running)
    finally:
        service.shutdown()


def test_tracking_alone_also_owns_the_sensor(settings: SettingsStore) -> None:
    service, link, _ = build(settings)
    try:
        service.set_tracking(True)

        assert wait_until(lambda: len(link.sent_points()) > 0)
        assert service.tracking_active is True
    finally:
        service.shutdown()


def test_two_consumers_share_one_capture_loop(settings: SettingsStore) -> None:
    service, link, preview = build(settings)
    try:
        service.set_tracking(True)
        service.add_viewer()

        assert wait_until(lambda: preview.latest()[1] is not None and link.sent_points())
        # The invariant that matters: the sensor was acquired exactly once.
        assert CountingCamera.opens == 1
    finally:
        service.shutdown()


def test_tracking_stops_sending_when_disabled(settings: SettingsStore) -> None:
    service, link, _ = build(settings)
    try:
        service.set_tracking(True)
        assert wait_until(lambda: len(link.sent_points()) > 0)

        service.set_tracking(False)
        assert wait_until(lambda: not service.running)
        settled = len(link.sent_points())
        time.sleep(0.2)

        assert len(link.sent_points()) == settled
    finally:
        service.shutdown()


def test_without_eyes_tracking_never_becomes_active(settings: SettingsStore) -> None:
    service, _, _ = build(settings, with_eyes=False)
    try:
        service.set_tracking(True)
        time.sleep(0.2)

        assert service.tracking_active is False
        assert service.running is False
    finally:
        service.shutdown()


def test_missing_camera_is_reported_not_raised(settings: SettingsStore) -> None:
    class BrokenCamera(MockCamera):
        def open(self) -> None:
            raise OSError("Device or resource busy")

    service = CameraService(
        camera_factory=BrokenCamera,
        tracker=FaceTracker(),
        preview=PreviewStream(),
        events=EventHub(),
        settings=settings,
        eyes=None,
    )
    service.add_viewer()

    assert wait_until(lambda: service.status()["camera"]["error"] is not None)
    assert service.running is False
    service.shutdown()


def test_unavailable_camera_never_starts(settings: SettingsStore) -> None:
    service = CameraService(
        camera_factory=CountingCamera,
        tracker=FaceTracker(),
        preview=PreviewStream(),
        events=EventHub(),
        settings=settings,
        eyes=None,
        available=False,
    )
    service.add_viewer()
    time.sleep(0.2)

    assert service.running is False
    assert CountingCamera.opens == 0
    service.shutdown()


def test_vflip_setting_is_persisted(settings: SettingsStore) -> None:
    service, _, _ = build(settings)
    try:
        service.set_vflip(True)

        assert settings.get().vflip is True
        assert service.status()["camera"]["vflip"] is True
    finally:
        service.shutdown()
