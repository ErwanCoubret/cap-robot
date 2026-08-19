"""Persisted runtime settings."""

from __future__ import annotations

from pathlib import Path

from capd.settings_store import Settings, SettingsStore


def test_defaults_apply_when_file_is_missing(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path / "settings.json", Settings(vflip=True))
    assert store.get().vflip is True
    assert store.get().tracking_enabled is True


def test_update_persists_and_reloads(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    store = SettingsStore(path, Settings())

    store.update(vflip=True)

    assert store.get().vflip is True
    # A fresh store reads the value back, proving it hit the disk.
    assert SettingsStore(path, Settings()).get().vflip is True


def test_update_ignores_unknown_and_none_values(tmp_path: Path) -> None:
    store = SettingsStore(tmp_path / "settings.json", Settings())

    store.update(vflip=None, bogus=True, tracking_enabled=False)

    assert store.get().vflip is False
    assert store.get().tracking_enabled is False
    assert not hasattr(store.get(), "bogus")


def test_corrupted_file_falls_back_to_defaults(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text("{ this is not json", encoding="utf-8")

    store = SettingsStore(path, Settings(vflip=True))

    assert store.get().vflip is True


def test_partial_file_keeps_defaults_for_missing_keys(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    path.write_text('{"vflip": true}', encoding="utf-8")

    store = SettingsStore(path, Settings(vflip=False, tracking_enabled=False))

    assert store.get().vflip is True
    assert store.get().tracking_enabled is False


def test_write_is_atomic(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    store = SettingsStore(path, Settings())

    store.update(vflip=True)

    # No temporary file is left behind after a successful save.
    assert [p.name for p in tmp_path.iterdir()] == ["settings.json"]
