"""Hardware discovery."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from capd.capabilities import probe
from capd.config import Config, load_config


@pytest.fixture
def real_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Config:
    monkeypatch.setenv("CAP_HW_MOCK", "0")
    monkeypatch.setenv("CAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CAP_SERIAL_PORT", str(tmp_path / "ttyUSB-absent"))
    return load_config()


def test_mock_mode_reports_everything_but_the_servo(config: Config) -> None:
    capabilities = probe(config)

    assert capabilities.mock is True
    assert capabilities.camera and capabilities.eyes and capabilities.mic and capabilities.speaker
    assert capabilities.servo is False
    assert capabilities.tts == "mock"


def test_missing_hardware_is_reported_with_a_reason(real_config: Config) -> None:
    capabilities = probe(real_config)

    assert capabilities.camera is False
    assert capabilities.eyes is False
    assert "camera" in capabilities.reasons
    assert real_config.serial_port in capabilities.reasons["eyes"]


def test_serial_capability_follows_the_device_node(real_config: Config, tmp_path: Path) -> None:
    port = tmp_path / "ttyUSB0"
    port.touch()

    capabilities = probe(replace(real_config, serial_port=str(port)))

    assert capabilities.eyes is True


def test_status_payload_is_json_serialisable(config: Config) -> None:
    payload = probe(config).to_dict()

    assert payload["servo"] is False
    assert isinstance(payload["reasons"], dict)
