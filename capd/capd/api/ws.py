"""WebSocket event stream.

The Next.js server keeps one connection open and re-publishes what arrives here
onto its own bus, which the browser consumes over SSE. Clients are pure
listeners: commands always go through the HTTP routes.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..runtime import Runtime

logger = logging.getLogger(__name__)

ws_router = APIRouter()


@ws_router.websocket("/events")
async def events(websocket: WebSocket) -> None:
    """Stream daemon events until the client disconnects."""
    runtime: Runtime = websocket.app.state.runtime
    await websocket.accept()

    async with runtime.events.subscribe() as queue:
        # The greeting carries the full state so a reconnecting client is
        # immediately consistent without polling /status.
        await websocket.send_json({"type": "hello", **runtime.status()})
        try:
            while True:
                event = await queue.get()
                await websocket.send_json(event)
        except WebSocketDisconnect:
            logger.debug("event client disconnected")
        except RuntimeError:
            # Raised when the socket is closed while a send is in flight.
            logger.debug("event stream closed mid-send")
