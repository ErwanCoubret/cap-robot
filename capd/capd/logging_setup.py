"""Logging configuration for the daemon.

One flat, greppable format for the whole process: the daemon is read through
``journalctl`` on the Pi, where multi-line output is painful to follow.
"""

from __future__ import annotations

import logging
import os

_CONFIGURED = False


def setup_logging() -> None:
    """Configure root logging once, honouring ``LOG_LEVEL``."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    _CONFIGURED = True
