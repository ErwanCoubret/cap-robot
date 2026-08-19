"""Microphone capture and speaker playback.

Both sides shell out to ALSA (``arecord`` / ``aplay``) rather than binding a
Python audio library: the capture parameters below are the ones verified on the
robot's USB microphone, and staying close to the tools used during bring-up
keeps debugging on the Pi simple.
"""

from __future__ import annotations

import logging
import signal
import subprocess
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path

from ..audio_tools import write_wav

logger = logging.getLogger(__name__)

#: Verified capture format of the AGPTEK lapel microphone, and what the
#: speech-to-text providers expect anyway.
SAMPLE_RATE = 16000
CHANNELS = 1
FORMAT = "S16_LE"

#: How long to wait for a recorder or player to exit before killing it.
EXIT_GRACE_SECONDS = 5.0


class Microphone(ABC):
    """Captures audio to a wav file."""

    @abstractmethod
    def start(self, destination: Path) -> None:
        """Begin capturing into ``destination``."""

    @abstractmethod
    def stop(self) -> None:
        """Finish the capture, leaving a playable wav file behind."""

    @abstractmethod
    def abort(self) -> None:
        """Stop capturing and discard whatever was recorded."""

    @property
    @abstractmethod
    def active(self) -> bool:
        """Whether a capture is currently running."""


class Speaker(ABC):
    """Plays wav files out loud."""

    @abstractmethod
    def play(self, path: Path) -> None:
        """Play ``path``, blocking until playback ends or is interrupted."""

    @abstractmethod
    def stop(self) -> None:
        """Interrupt the playback currently in progress, if any."""


class ArecordMicrophone(Microphone):
    """Captures with ``arecord`` on the configured ALSA device."""

    def __init__(self, device: str) -> None:
        self._device = device
        self._process: subprocess.Popen[bytes] | None = None
        self._destination: Path | None = None
        self._lock = threading.Lock()

    @property
    def active(self) -> bool:
        with self._lock:
            return self._process is not None and self._process.poll() is None

    def start(self, destination: Path) -> None:
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                raise RuntimeError("a capture is already running")
            destination.parent.mkdir(parents=True, exist_ok=True)
            command = [
                "arecord",
                "-D",
                self._device,
                "-f",
                FORMAT,
                "-r",
                str(SAMPLE_RATE),
                "-c",
                str(CHANNELS),
                "-t",
                "wav",
                str(destination),
            ]
            logger.info("starting capture device=%s path=%s", self._device, destination)
            self._process = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            self._destination = destination

    def stop(self) -> None:
        with self._lock:
            process = self._process
            self._process = None
            self._destination = None

        if process is None or process.poll() is not None:
            return

        # SIGINT is how arecord is meant to be stopped: it finalises the wav
        # header on the way out, which SIGKILL would skip and leave a file no
        # decoder can read.
        process.send_signal(signal.SIGINT)
        try:
            _, stderr = process.communicate(timeout=EXIT_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            logger.warning("arecord did not exit in time, killing it")
            process.kill()
            process.communicate()
            return
        if process.returncode not in (0, -signal.SIGINT):
            logger.warning(
                "arecord exited with code=%s stderr=%s",
                process.returncode,
                (stderr or b"").decode("utf-8", "replace").strip(),
            )

    def abort(self) -> None:
        with self._lock:
            process = self._process
            destination = self._destination
            self._process = None
            self._destination = None

        if process is not None and process.poll() is None:
            process.kill()
            process.communicate()
        if destination is not None:
            destination.unlink(missing_ok=True)


class MockMicrophone(Microphone):
    """Synthesises a recording whose length matches the real elapsed time.

    Keeping the duration honest matters: the rest of the pipeline reports it to
    the user and uses it to decide whether anything was actually said.
    """

    def __init__(self) -> None:
        self._destination: Path | None = None
        self._started_at: float | None = None
        self._lock = threading.Lock()

    @property
    def active(self) -> bool:
        with self._lock:
            return self._destination is not None

    def start(self, destination: Path) -> None:
        with self._lock:
            if self._destination is not None:
                raise RuntimeError("a capture is already running")
            self._destination = destination
            self._started_at = time.monotonic()
        logger.info("starting mock capture path=%s", destination)

    def stop(self) -> None:
        with self._lock:
            destination = self._destination
            started_at = self._started_at
            self._destination = None
            self._started_at = None

        if destination is None or started_at is None:
            return

        elapsed = max(0.2, time.monotonic() - started_at)
        # A two-syllable hum stands in for speech, so waveform-based checks
        # (peak/rms) behave like they would with a real voice.
        half = elapsed / 2
        write_wav(
            destination,
            [(210.0, half, 0.3), (170.0, elapsed - half, 0.25)],
            rate=SAMPLE_RATE,
        )

    def abort(self) -> None:
        with self._lock:
            destination = self._destination
            self._destination = None
            self._started_at = None
        if destination is not None:
            destination.unlink(missing_ok=True)


class AplaySpeaker(Speaker):
    """Plays wav files with ``aplay``."""

    def __init__(self, device: str) -> None:
        self._device = device
        self._process: subprocess.Popen[bytes] | None = None
        self._lock = threading.Lock()

    def play(self, path: Path) -> None:
        command = ["aplay", "-q"]
        if self._device and self._device != "default":
            command += ["-D", self._device]
        command.append(str(path))

        with self._lock:
            self._process = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            process = self._process

        _, stderr = process.communicate()
        with self._lock:
            if self._process is process:
                self._process = None

        if process.returncode not in (0, -signal.SIGTERM, -signal.SIGKILL):
            logger.warning(
                "aplay exited with code=%s stderr=%s",
                process.returncode,
                (stderr or b"").decode("utf-8", "replace").strip(),
            )

    def stop(self) -> None:
        with self._lock:
            process = self._process
        if process is not None and process.poll() is None:
            process.terminate()


class MockSpeaker(Speaker):
    """Pretends to play, waiting for the real duration of the file.

    Waiting is what makes the mock useful: the speaking state lasts as long as
    it would on the robot, so the interface can be exercised realistically.
    """

    def __init__(self) -> None:
        self._interrupt = threading.Event()
        self.played: list[Path] = []

    def play(self, path: Path) -> None:
        from ..audio_tools import wav_duration

        self.played.append(path)
        self._interrupt.clear()
        duration = min(wav_duration(path), 30.0)
        logger.info("mock playback path=%s duration=%.2fs", path, duration)
        self._interrupt.wait(timeout=duration)

    def stop(self) -> None:
        self._interrupt.set()
