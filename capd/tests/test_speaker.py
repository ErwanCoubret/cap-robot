"""Speech queue behaviour."""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from capd.events import EventHub
from capd.hardware.audio import MockSpeaker
from capd.hardware.tts import MockTts
from capd.services.speaker import SpeakService


class RecordingHub(EventHub):
    """Event hub capturing everything published, without a loop."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict] = []

    def _dispatch(self, event: dict) -> None:  # type: ignore[override]
        self.events.append(event)

    def states_for(self, event_type: str) -> list[str]:
        return [e["state"] for e in self.events if e["type"] == event_type]


@pytest.fixture
def hub() -> RecordingHub:
    return RecordingHub()


@pytest.fixture
def service(tmp_path: Path, hub: RecordingHub) -> Iterator[SpeakService]:
    speech = SpeakService(MockTts(), MockSpeaker(), hub, tmp_path)
    speech.start()
    try:
        yield speech
    finally:
        speech.shutdown()


def wait_until(predicate, timeout: float = 5.0) -> bool:
    """Poll ``predicate`` until it holds or ``timeout`` elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_speaking_emits_started_then_finished(service: SpeakService, hub: RecordingHub) -> None:
    service.speak("Bonjour")

    assert wait_until(lambda: hub.states_for("speaking") == ["started", "finished"])


def test_utterances_are_played_in_order(service: SpeakService, hub: RecordingHub) -> None:
    service.speak("un")
    service.speak("deux")

    assert wait_until(lambda: hub.states_for("speaking").count("finished") == 2)
    spoken = [e.get("text") for e in hub.events if e.get("state") == "started"]
    assert spoken == ["un", "deux"]


def test_long_text_is_synthesised_in_chunks(tmp_path: Path, hub: RecordingHub) -> None:
    tts = MockTts()
    service = SpeakService(tts, MockSpeaker(), hub, tmp_path, max_chunk_chars=20)
    service.start()
    try:
        service.speak("Il est huit heures. Tu as trois tâches.")
        assert wait_until(lambda: hub.states_for("speaking") == ["started", "finished"])
    finally:
        service.shutdown()

    # Each sentence is rendered separately so playback can start early.
    assert tts.spoken == ["Il est huit heures.", "Tu as trois tâches."]


def test_empty_text_finishes_immediately(service: SpeakService, hub: RecordingHub) -> None:
    utterance_id = service.speak("   ")

    assert hub.states_for("speaking") == ["finished"]
    assert hub.events[0]["utterance_id"] == utterance_id


def test_stop_drops_the_queue(service: SpeakService, hub: RecordingHub) -> None:
    for index in range(5):
        service.speak(f"phrase numéro {index}")

    service.stop()

    assert wait_until(lambda: service.status()["queue"] == 0)
    assert hub.states_for("speaking").count("finished") < 5


def test_sound_is_played_from_a_generated_file(service: SpeakService, hub: RecordingHub) -> None:
    service.play_sound("chime")

    assert wait_until(lambda: hub.states_for("speaking") == ["started", "finished"])
    assert hub.events[0]["kind"] == "sound"


def test_unknown_sound_is_rejected(service: SpeakService) -> None:
    with pytest.raises(KeyError):
        service.play_sound("nope")


def test_status_reports_engine_and_queue(service: SpeakService) -> None:
    status = service.status()

    assert status["engine"] == "mock"
    assert status["queue"] == 0
    assert status["active"] is False
