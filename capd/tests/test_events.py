"""Event fan-out, including publication from worker threads."""

from __future__ import annotations

import asyncio
import threading

from capd.events import EventHub


def test_publish_without_a_loop_is_safe() -> None:
    # Unit tests and early startup publish before the loop exists; dropping
    # silently is preferable to raising inside a hardware thread.
    EventHub().publish("face", visible=True)


def test_subscribers_receive_events() -> None:
    async def scenario() -> dict:
        hub = EventHub()
        hub.bind_loop(asyncio.get_running_loop())
        async with hub.subscribe() as queue:
            hub.publish("speaking", state="started")
            return await asyncio.wait_for(queue.get(), timeout=1)

    assert asyncio.run(scenario()) == {"type": "speaking", "state": "started"}


def test_publish_from_another_thread_is_marshalled_onto_the_loop() -> None:
    async def scenario() -> dict:
        hub = EventHub()
        hub.bind_loop(asyncio.get_running_loop())
        async with hub.subscribe() as queue:
            threading.Thread(
                target=hub.publish, args=("face",), kwargs={"visible": True}
            ).start()
            return await asyncio.wait_for(queue.get(), timeout=2)

    assert asyncio.run(scenario()) == {"type": "face", "visible": True}


def test_slow_subscriber_drops_oldest_events() -> None:
    async def scenario() -> list[dict]:
        hub = EventHub(queue_size=2)
        hub.bind_loop(asyncio.get_running_loop())
        async with hub.subscribe() as queue:
            for index in range(5):
                hub.publish("face", index=index)
            return [queue.get_nowait() for _ in range(queue.qsize())]

    events = asyncio.run(scenario())

    # The buffer keeps the freshest coordinates rather than a stale backlog.
    assert [event["index"] for event in events] == [3, 4]


def test_unsubscribed_queues_stop_receiving() -> None:
    async def scenario() -> int:
        hub = EventHub()
        hub.bind_loop(asyncio.get_running_loop())
        async with hub.subscribe() as queue:
            pass
        hub.publish("face", visible=False)
        return queue.qsize()

    assert asyncio.run(scenario()) == 0
