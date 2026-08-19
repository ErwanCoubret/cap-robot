"""Configuration parsing."""

from __future__ import annotations

from pathlib import Path

import pytest

from capd.config import DEFAULT_FACE_MODEL, env_bool, env_int, env_str, load_config


def test_env_str_skips_empty_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PRIMARY", "   ")
    monkeypatch.setenv("LEGACY", "value")
    assert env_str("PRIMARY", "LEGACY", default="fallback") == "value"


def test_env_str_falls_back_to_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MISSING", raising=False)
    assert env_str("MISSING", default="fallback") == "fallback"


@pytest.mark.parametrize("raw, expected", [("1", True), ("TRUE", True), ("on", True), ("0", False), ("nope", False)])
def test_env_bool(monkeypatch: pytest.MonkeyPatch, raw: str, expected: bool) -> None:
    monkeypatch.setenv("FLAG", raw)
    assert env_bool("FLAG") is expected


def test_env_int_ignores_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT", "not-a-number")
    assert env_int("PORT", default=8790) == 8790


def test_default_face_model_points_inside_modules() -> None:
    # The path moved when the tree was reorganised under modules/; the default
    # is derived from the repository root so it cannot go stale again.
    assert DEFAULT_FACE_MODEL.parts[-6:] == (
        "modules",
        "ai-camera",
        "models",
        "yolov8n-face-lindevs_imx_model",
        "rpk",
        "network.rpk",
    )


def test_load_config_reads_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAP_HW_MOCK", "1")
    monkeypatch.setenv("CAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CAP_SERIAL_PORT", "/dev/ttyTEST")
    monkeypatch.setenv("CAPD_PORT", "9999")

    config = load_config()

    assert config.mock is True
    assert config.data_dir == tmp_path
    assert config.serial_port == "/dev/ttyTEST"
    assert config.port == 9999
    assert config.recordings_dir == tmp_path / "recordings"
    assert config.settings_path == tmp_path / "capd-settings.json"
