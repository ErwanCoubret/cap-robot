"""Shared pytest fixtures.

Every test runs the daemon in mock mode against a temporary data directory, so
no test can touch the developer's real state or the robot's hardware.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from capd.api.app import create_app
from capd.config import Config, load_config


@pytest.fixture
def config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Config:
    """A mock-mode configuration rooted in a temporary directory."""
    monkeypatch.setenv("CAP_HW_MOCK", "1")
    monkeypatch.setenv("CAP_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("CAP_TTS", "mock")
    return load_config()


@pytest.fixture
def client(config: Config) -> Iterator[TestClient]:
    """A TestClient whose lifespan (and therefore services) is running."""
    with TestClient(create_app(config)) as test_client:
        yield test_client
