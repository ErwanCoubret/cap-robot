"""Console entry point: ``python -m capd`` / ``capd``."""

from __future__ import annotations

import uvicorn

from .config import load_config
from .logging_setup import setup_logging


def main() -> None:
    """Run the daemon with uvicorn using the environment configuration."""
    setup_logging()
    config = load_config()
    uvicorn.run(
        "capd.api.app:create_app",
        factory=True,
        host=config.host,
        port=config.port,
        log_config=None,
    )


if __name__ == "__main__":
    main()
