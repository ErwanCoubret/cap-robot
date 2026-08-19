"""
Records a short clip on the AC02B mic and prints peak/RMS level, so a
"silent" recording (bad cable, wrong device, muted gain) can be told apart
from a quiet room without opening the wav in an external tool.
"""

import argparse
import struct
import subprocess
import wave

DEVICE = "plughw:CARD=Device,DEV=0"
RATE = 16000
OUT_PATH = "/tmp/mictest.wav"


def record(seconds, device=DEVICE, out_path=OUT_PATH):
    subprocess.run(
        [
            "arecord",
            "-D", device,
            "-f", "S16_LE",
            "-r", str(RATE),
            "-d", str(seconds),
            out_path,
        ],
        check=True,
    )
    return out_path


def levels(path):
    with wave.open(path, "rb") as w:
        n = w.getnframes()
        samples = struct.unpack(f"<{n}h", w.readframes(n))
    peak = max(abs(s) for s in samples)
    rms = (sum(s * s for s in samples) / n) ** 0.5
    return peak, rms


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=4)
    parser.add_argument("--device", default=DEVICE)
    args = parser.parse_args()

    print(f"Recording {args.seconds}s on {args.device} — talk or clap now")
    path = record(args.seconds, args.device)
    peak, rms = levels(path)
    print(f"peak={peak} rms={rms:.1f} (max=32767)")
    if peak < 300:
        print("Peak is near silence — check mic placement, gain, or cable.")
