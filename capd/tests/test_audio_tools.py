"""Wav generation and measurement helpers."""

from __future__ import annotations

import wave
from pathlib import Path

from capd.audio_tools import write_silence, write_wav, wav_duration
from capd.services.sounds import SOUNDS, available_sounds, ensure_sound


def test_write_wav_produces_a_readable_mono_file(tmp_path: Path) -> None:
    path = write_wav(tmp_path / "tone.wav", [(440.0, 0.25, 0.3)])

    with wave.open(str(path), "rb") as handle:
        assert handle.getnchannels() == 1
        assert handle.getsampwidth() == 2

    assert abs(wav_duration(path) - 0.25) < 0.02


def test_write_wav_is_atomic(tmp_path: Path) -> None:
    write_wav(tmp_path / "tone.wav", [(440.0, 0.05, 0.3)])

    assert [p.name for p in tmp_path.iterdir()] == ["tone.wav"]


def test_silence_has_the_requested_duration(tmp_path: Path) -> None:
    path = write_silence(tmp_path / "quiet.wav", 0.4)

    assert abs(wav_duration(path) - 0.4) < 0.02


def test_duration_of_a_missing_or_broken_file_is_zero(tmp_path: Path) -> None:
    assert wav_duration(tmp_path / "absent.wav") == 0.0

    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"definitely not a wav")
    assert wav_duration(broken) == 0.0


def test_sounds_are_generated_once_and_reused(tmp_path: Path) -> None:
    first = ensure_sound("chime", tmp_path)
    stamp = first.stat().st_mtime_ns

    second = ensure_sound("chime", tmp_path)

    assert first == second
    assert second.stat().st_mtime_ns == stamp


def test_every_declared_sound_can_be_generated(tmp_path: Path) -> None:
    for name in available_sounds():
        assert wav_duration(ensure_sound(name, tmp_path)) > 0

    assert set(available_sounds()) == set(SOUNDS)
