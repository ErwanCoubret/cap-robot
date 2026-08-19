"""The single writer of the ESP32 eyes serial link.

Two things contend for this port: continuous face-tracking coordinates and
short expressive animations. The firmware reads one line per render loop, so
flooding it overflows the receive buffer and the eye freezes — the reason
everything funnels through one thread with a hard rate cap here.
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass

logger = logging.getLogger(__name__)

#: 20 Hz. The firmware smooths movement itself, so more frames buy nothing and
#: risk overflowing its receive buffer.
MIN_SEND_INTERVAL = 0.05

#: CH340 boards reset when the host asserts DTR on open; writing before the
#: firmware is back up sends coordinates into the void.
BOOT_DELAY_SECONDS = 2.0


@dataclass(frozen=True, slots=True)
class Step:
    """One coordinate to send, held for ``hold`` seconds afterwards."""

    x: int
    y: int
    hold: float = 0.0


class EyesLink(ABC):
    """Transport carrying ``"x,y\\n"`` lines to the eyes."""

    @abstractmethod
    def write_line(self, line: str) -> None:
        """Send one line, or drop it if the device is not consuming."""

    @abstractmethod
    def close(self) -> None:
        """Release the underlying device."""


class SerialEyesLink(EyesLink):
    """pyserial transport to the ESP32."""

    def __init__(self, port: str, baud: int) -> None:
        import serial

        self._serial_module = serial
        self._port = serial.Serial(port, baud, timeout=1, write_timeout=1)
        # Let the board finish booting before the first coordinate.
        time.sleep(BOOT_DELAY_SECONDS)
        self._port.reset_input_buffer()
        self._port.reset_output_buffer()
        logger.info("eyes serial open port=%s baud=%s", port, baud)

    def write_line(self, line: str) -> None:
        try:
            self._port.write(line.encode())
        except self._serial_module.SerialTimeoutException:
            # The ESP32 stopped consuming: skip this frame rather than block
            # the writer thread. The next coordinate supersedes it anyway.
            logger.warning("eyes serial write timed out, frame dropped")

    def close(self) -> None:
        try:
            if self._port.is_open:
                self._port.close()
        except Exception:
            logger.debug("closing eyes serial failed", exc_info=True)


class MockEyesLink(EyesLink):
    """Transport recording what would have been sent."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self._lock = threading.Lock()

    def write_line(self, line: str) -> None:
        with self._lock:
            self.lines.append(line.strip())

    def close(self) -> None:
        pass

    def sent_points(self) -> list[tuple[int, int]]:
        """Return the coordinates written so far."""
        with self._lock:
            points = []
            for line in self.lines:
                x, _, y = line.partition(",")
                points.append((int(x), int(y)))
            return points


class EyesBus:
    """Serialises every write to the eyes, arbitrating between two priorities.

    Expressions take an exclusive lease: while one plays, tracking coordinates
    are dropped instead of queued, so the animation is not fought over by the
    face tracker frame by frame. Tracking itself is coalesced — only the most
    recent coordinate matters, an older one is never worth sending.
    """

    def __init__(self, link: EyesLink, min_interval: float = MIN_SEND_INTERVAL) -> None:
        self._link = link
        self._min_interval = min_interval
        self._cond = threading.Condition()
        self._pending: tuple[int, int] | None = None
        self._steps: list[Step] = []
        self._lease_until = 0.0
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None
        self._sent = 0
        self._dropped = 0

    def start(self) -> None:
        """Start the writer thread."""
        if self._worker is not None:
            return
        self._stop.clear()
        self._worker = threading.Thread(target=self._run, name="capd-eyes", daemon=True)
        self._worker.start()

    def stop(self) -> None:
        """Stop the writer thread and close the link."""
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        worker = self._worker
        self._worker = None
        if worker is not None:
            worker.join(timeout=2.0)
        self._link.close()

    @property
    def expression_active(self) -> bool:
        """Whether an expression currently holds the exclusive lease."""
        with self._cond:
            return self._lease_active()

    def status(self) -> dict[str, object]:
        """Return counters for the daemon status payload."""
        with self._cond:
            return {
                "sent": self._sent,
                "dropped": self._dropped,
                "expression_active": self._lease_active(),
            }

    def send_tracking(self, x: int, y: int) -> bool:
        """Queue a tracking coordinate. Returns False when it was dropped."""
        with self._cond:
            if self._lease_active():
                self._dropped += 1
                return False
            self._pending = (x, y)
            self._cond.notify()
            return True

    def play(self, steps: list[Step], lease_seconds: float | None = None) -> None:
        """Play an expression, taking the exclusive lease while it runs."""
        if not steps:
            return
        duration = lease_seconds if lease_seconds is not None else sum(
            max(step.hold, self._min_interval) for step in steps
        )
        with self._cond:
            self._steps = list(steps)
            self._pending = None
            self._lease_until = time.monotonic() + duration
            self._cond.notify()

    def _lease_active(self) -> bool:
        return bool(self._steps) or time.monotonic() < self._lease_until

    def _run(self) -> None:
        while not self._stop.is_set():
            with self._cond:
                if self._steps:
                    step = self._steps.pop(0)
                elif self._pending is not None and not self._lease_active():
                    step = Step(*self._pending)
                    self._pending = None
                else:
                    self._cond.wait(0.1)
                    continue

            self._link.write_line(f"{step.x},{step.y}\n")
            with self._cond:
                self._sent += 1

            # The rate cap applies to every write, expressive or not.
            self._stop.wait(max(self._min_interval, step.hold))
