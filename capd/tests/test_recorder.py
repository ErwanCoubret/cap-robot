"""Recorder state machine."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from capd.events import EventHub
from capd.hardware.audio import MockMicrophone
from capd.services.recorder import RETAINED_RECORDINGS, RecorderError, RecorderService


@pytest.fixture
def recorder(tmp_path: Path) -> RecorderService:
    return RecorderService(
        microphone=MockMicrophone(),
        events=EventHub(),
        recordings_dir=tmp_path / "recordings",
        max_seconds=120,
    )


def test_start_then_stop_produces_a_playable_file(recorder: RecorderService) -> None:
    recording_id = recorder.start()
    assert recorder.active is True

    recording = recorder.stop()

    assert recording.recording_id == recording_id
    assert recording.path.exists()
    assert recording.duration_s > 0
    assert recorder.active is False


def test_double_start_is_rejected(recorder: RecorderService) -> None:
    recorder.start()
    with pytest.raises(RecorderError):
        recorder.start()


def test_stop_without_start_is_rejected(recorder: RecorderService) -> None:
    with pytest.raises(RecorderError):
        recorder.stop()


def test_cancel_discards_the_file(recorder: RecorderService) -> None:
    recorder.start()
    recorder.cancel()

    assert recorder.active is False
    assert list((recorder._dir).glob("*.wav")) == []


def test_cancel_without_recording_is_a_noop(recorder: RecorderService) -> None:
    recorder.cancel()  # must not raise


def test_watchdog_stops_an_overlong_capture(tmp_path: Path) -> None:
    recorder = RecorderService(
        microphone=MockMicrophone(),
        events=EventHub(),
        recordings_dir=tmp_path,
        max_seconds=1,
    )
    recorder.start()

    deadline = time.monotonic() + 5
    while recorder.active and time.monotonic() < deadline:
        time.sleep(0.05)

    assert recorder.active is False


def test_requested_limit_cannot_exceed_the_configured_maximum(tmp_path: Path) -> None:
    recorder = RecorderService(
        microphone=MockMicrophone(),
        events=EventHub(),
        recordings_dir=tmp_path,
        max_seconds=1,
    )
    recorder.start(max_seconds=600)

    deadline = time.monotonic() + 5
    while recorder.active and time.monotonic() < deadline:
        time.sleep(0.05)

    assert recorder.active is False


def test_path_for_rejects_traversal(recorder: RecorderService) -> None:
    assert recorder.path_for("../../etc/passwd") is None
    assert recorder.path_for("rec_../secret") is None


def test_path_for_returns_finished_recordings(recorder: RecorderService) -> None:
    recorder.start()
    recording = recorder.stop()

    assert recorder.path_for(recording.recording_id) == recording.path
    assert recorder.path_for("rec_deadbeef") is None


def test_events_describe_the_lifecycle(tmp_path: Path) -> None:
    events: list[dict] = []
    hub = EventHub()
    hub._dispatch = lambda event: events.append(event)  # type: ignore[method-assign]
    recorder = RecorderService(MockMicrophone(), hub, tmp_path, 120)

    recorder.start()
    recorder.stop()

    assert [event["state"] for event in events] == ["started", "stopped"]
    assert events[1]["duration_s"] > 0


def test_old_recordings_are_pruned(tmp_path: Path) -> None:
    recorder = RecorderService(MockMicrophone(), EventHub(), tmp_path, 120)
    for index in range(RETAINED_RECORDINGS + 3):
        (tmp_path / f"rec_old{index:03d}.wav").write_bytes(b"stale")

    recorder.start()
    recorder.stop()

    assert len(list(tmp_path.glob("rec_*.wav"))) <= RETAINED_RECORDINGS + 1
