"""Serial arbitration for the eyes.

The invariants here are the ones that keep the eye from freezing: one writer,
a hard rate cap, tracking coordinates coalesced, and expressions holding an
exclusive lease while they play.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

import pytest

from capd.hardware.eyes_bus import EyesBus, MockEyesLink, Step


@pytest.fixture
def link() -> MockEyesLink:
    return MockEyesLink()


@pytest.fixture
def bus(link: MockEyesLink) -> Iterator[EyesBus]:
    instance = EyesBus(link, min_interval=0.01)
    instance.start()
    try:
        yield instance
    finally:
        instance.stop()


def wait_until(predicate, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def test_tracking_coordinates_reach_the_link(bus: EyesBus, link: MockEyesLink) -> None:
    bus.send_tracking(100, 140)

    assert wait_until(lambda: link.sent_points() == [(100, 140)])


def test_protocol_is_x_comma_y_newline(bus: EyesBus, link: MockEyesLink) -> None:
    bus.send_tracking(12, 34)

    assert wait_until(lambda: link.lines == ["12,34"])


def test_tracking_frames_are_coalesced(link: MockEyesLink) -> None:
    # A slow writer must send the newest coordinate, not work through a
    # backlog of stale ones.
    bus = EyesBus(link, min_interval=0.05)
    bus.start()
    try:
        for index in range(50):
            bus.send_tracking(index, index)
        assert wait_until(lambda: len(link.sent_points()) >= 1)
        time.sleep(0.2)
    finally:
        bus.stop()

    points = link.sent_points()
    assert len(points) < 10
    assert points[-1][0] > 10


def test_rate_is_capped(link: MockEyesLink) -> None:
    bus = EyesBus(link, min_interval=0.05)
    bus.start()
    try:
        started = time.monotonic()
        while time.monotonic() - started < 0.35:
            bus.send_tracking(int(time.monotonic() * 100) % 240, 120)
            time.sleep(0.005)
    finally:
        bus.stop()

    # 0.35s at 20 Hz allows roughly 7 writes; anything close to the hundreds of
    # calls made above would overflow the firmware's receive buffer.
    assert len(link.lines) <= 10


def test_expression_takes_an_exclusive_lease(link: MockEyesLink) -> None:
    bus = EyesBus(link, min_interval=0.01)
    bus.start()
    try:
        bus.play([Step(60, 120, 0.05), Step(180, 120, 0.05)], lease_seconds=0.3)
        assert bus.expression_active is True

        # Tracking is dropped rather than queued while the animation plays.
        assert bus.send_tracking(10, 10) is False
        assert wait_until(lambda: link.sent_points()[:2] == [(60, 120), (180, 120)])
        assert (10, 10) not in link.sent_points()
    finally:
        bus.stop()


def test_tracking_resumes_after_the_lease_expires(link: MockEyesLink) -> None:
    bus = EyesBus(link, min_interval=0.01)
    bus.start()
    try:
        bus.play([Step(60, 120, 0.02)], lease_seconds=0.1)
        assert wait_until(lambda: not bus.expression_active, timeout=2)

        assert bus.send_tracking(200, 40) is True
        assert wait_until(lambda: (200, 40) in link.sent_points())
    finally:
        bus.stop()


def test_empty_expression_is_ignored(bus: EyesBus, link: MockEyesLink) -> None:
    bus.play([])

    assert bus.expression_active is False
    assert link.lines == []


def test_status_counts_sent_and_dropped(link: MockEyesLink) -> None:
    bus = EyesBus(link, min_interval=0.01)
    bus.start()
    try:
        bus.send_tracking(1, 1)
        assert wait_until(lambda: bus.status()["sent"] >= 1)

        bus.play([Step(120, 120, 0.2)], lease_seconds=0.5)
        bus.send_tracking(2, 2)
        assert bus.status()["dropped"] >= 1
    finally:
        bus.stop()


def test_stop_closes_the_link() -> None:
    class ClosingLink(MockEyesLink):
        closed = False

        def close(self) -> None:
            self.closed = True

    link = ClosingLink()
    bus = EyesBus(link)
    bus.start()
    bus.stop()

    assert link.closed is True
