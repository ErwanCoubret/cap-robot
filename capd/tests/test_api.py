"""HTTP and WebSocket surface in mock mode."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_status_shape(client: TestClient) -> None:
    payload = client.get("/status").json()

    assert payload["mock"] is True
    assert payload["capabilities"]["servo"] is False
    assert set(payload) == {"mock", "capabilities", "camera", "tracking", "recording", "speaking"}
    assert payload["camera"]["vflip"] is False


def test_events_socket_greets_with_full_state(client: TestClient) -> None:
    with client.websocket_connect("/events") as socket:
        hello = socket.receive_json()

    assert hello["type"] == "hello"
    assert hello["capabilities"]["mock"] is True


def test_events_socket_receives_published_events(client: TestClient) -> None:
    runtime = client.app.state.runtime

    with client.websocket_connect("/events") as socket:
        socket.receive_json()  # hello
        runtime.events.publish("tracking", active=True)
        event = socket.receive_json()

    assert event == {"type": "tracking", "active": True}


def test_record_roundtrip_serves_the_wav(client: TestClient) -> None:
    recording_id = client.post("/record/start", json={}).json()["recording_id"]
    assert client.get("/status").json()["recording"]["active"] is True

    stopped = client.post("/record/stop", json={}).json()
    assert stopped["recording_id"] == recording_id
    assert stopped["duration_s"] > 0

    audio = client.get(f"/record/{recording_id}/file")
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"
    assert audio.content[:4] == b"RIFF"


def test_second_record_start_conflicts(client: TestClient) -> None:
    client.post("/record/start", json={})
    try:
        assert client.post("/record/start", json={}).status_code == 409
    finally:
        client.post("/record/cancel")


def test_stop_without_recording_conflicts(client: TestClient) -> None:
    assert client.post("/record/stop", json={}).status_code == 409


def test_unknown_recording_is_not_found(client: TestClient) -> None:
    assert client.get("/record/rec_unknown01/file").status_code == 404


def test_speak_returns_an_utterance_id(client: TestClient) -> None:
    body = client.post("/speak", json={"text": "Bonjour Cap"}).json()

    assert body["utterance_id"].startswith("utt_")


def test_speak_rejects_empty_text(client: TestClient) -> None:
    assert client.post("/speak", json={"text": ""}).status_code == 422


def test_speak_stop_is_idempotent(client: TestClient) -> None:
    assert client.post("/speak/stop").json() == {"stopped": True}


def test_sound_accepts_known_names_only(client: TestClient) -> None:
    assert client.post("/sound", json={"name": "chime"}).status_code == 200

    rejected = client.post("/sound", json={"name": "kaboom"})
    assert rejected.status_code == 400
    assert "chime" in rejected.json()["detail"]
