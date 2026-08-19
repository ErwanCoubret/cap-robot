"""HTTP routes exposed by the hardware daemon.

The daemon binds to localhost only: the Next.js server is its single client and
proxies whatever the browser needs.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request

from ..runtime import Runtime

logger = logging.getLogger(__name__)

router = APIRouter()


def get_runtime(request: Request) -> Runtime:
    """Return the runtime wired at application startup."""
    return request.app.state.runtime


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness probe used by the installer and by systemd ordering."""
    return {"status": "ok"}


@router.get("/status")
def status(request: Request) -> dict[str, Any]:
    """Return capabilities and the live state of every hardware service."""
    return get_runtime(request).status()
