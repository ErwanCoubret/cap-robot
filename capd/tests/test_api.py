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
