"""FastAPI application factory for the Cap hardware daemon."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from ..config import Config
from ..logging_setup import setup_logging
from ..runtime import Runtime
from .routes import router
from .ws import ws_router

logger = logging.getLogger(__name__)


def create_app(config: Config | None = None) -> FastAPI:
    """Build the daemon application.

    ``config`` is injected by the tests; in production it is read from the
    environment. The runtime is attached to ``app.state`` so routes can reach
    the hardware services without module-level globals.
    """
    setup_logging()
    runtime = Runtime.build(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime.events.bind_loop(asyncio.get_running_loop())
        await runtime.start()
        try:
            yield
        finally:
            await runtime.stop()

    app = FastAPI(
        title="capd",
        version="0.1.0",
        summary="Cap robot hardware daemon",
        lifespan=lifespan,
    )
    app.state.runtime = runtime
    app.include_router(router)
    app.include_router(ws_router)
    return app
