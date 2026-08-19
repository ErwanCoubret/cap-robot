"""Fan-out of daemon events to every connected WebSocket client.

Hardware runs on plain threads (serial writer, capture loop, recorder), while
the API is asyncio. This hub is the single bridge between the two worlds: any
thread may call :meth:`EventHub.publish`, and delivery is marshalled onto the
event loop.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

logger = logging.getLogger(__name__)

#: Per-subscriber buffer. Face coordinates arrive continuously, so a slow client
#: must never be allowed to grow an unbounded backlog.
QUEUE_SIZE = 64


class EventHub:
    """Broadcast JSON-serialisable events to all subscribers."""

    def __init__(self, queue_size: int = QUEUE_SIZE) -> None:
        self._queue_size = queue_size
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Remember the API event loop so worker threads can publish into it."""
        self._loop = loop

    @property
    def subscriber_count(self) -> int:
        """Number of currently connected subscribers."""
        with self._lock:
            return len(self._subscribers)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[dict[str, Any]]]:
        """Yield a queue receiving every event published while subscribed."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(self._queue_size)
        with self._lock:
            self._subscribers.add(queue)
        try:
            yield queue
        finally:
            with self._lock:
                self._subscribers.discard(queue)

    def publish(self, event_type: str, **payload: Any) -> None:
        """Publish ``event_type`` with ``payload`` from any thread."""
        event = {"type": event_type, **payload}
        loop = self._loop

        if loop is None:
            self._dispatch(event)
            return

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None

        if running is loop:
            self._dispatch(event)
            return

        try:
            loop.call_soon_threadsafe(self._dispatch, event)
        except RuntimeError:
            # The loop is shutting down; dropping late events is correct here.
            logger.debug("event dropped after loop shutdown type=%s", event_type)

    def _dispatch(self, event: dict[str, Any]) -> None:
        with self._lock:
            subscribers = list(self._subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop the oldest event rather than the newest: for state
                # updates the most recent value is the useful one.
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    logger.debug("could not deliver event type=%s", event["type"])
