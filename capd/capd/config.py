"""Environment-driven configuration for the Cap hardware daemon.

Every tunable lives here so the rest of the package never reads ``os.environ``
directly. Values are resolved once at import of :func:`load_config` and passed
down explicitly, which keeps the services trivially testable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# capd/capd/config.py -> capd/capd -> capd -> repository root
REPO_ROOT = Path(__file__).resolve().parents[2]

# The IMX500 network is packed on the Pi (`imx500-package`) and is gitignored.
# The path moved when the tree was reorganised under modules/, which is why the
# default is computed from the repository root instead of being hardcoded.
DEFAULT_FACE_MODEL = (
    REPO_ROOT
    / "modules"
    / "ai-camera"
    / "models"
    / "yolov8n-face-lindevs_imx_model"
    / "rpk"
    / "network.rpk"
)

TRUTHY = {"1", "true", "yes", "on"}


def env_str(*names: str, default: str = "") -> str:
    """Return the first non-empty environment value among ``names``.

    Empty strings are skipped rather than winning, so an override left blank in
    a deployment panel falls back to the default instead of silently disabling
    the setting.
    """
    for name in names:
        value = os.environ.get(name)
        if value is not None and value.strip() != "":
            return value.strip()
    return default


def env_bool(*names: str, default: bool = False) -> bool:
    """Return the first environment value among ``names`` parsed as a boolean."""
    raw = env_str(*names)
    if raw == "":
        return default
    return raw.lower() in TRUTHY


def env_int(*names: str, default: int) -> int:
    """Return the first environment value among ``names`` parsed as an int."""
    raw = env_str(*names)
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_float(*names: str, default: float) -> float:
    """Return the first environment value among ``names`` parsed as a float."""
    raw = env_str(*names)
    if raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True, slots=True)
class Config:
    """Immutable snapshot of the daemon configuration."""

    mock: bool
    host: str
    port: int
    data_dir: Path

    serial_port: str
    serial_baud: int

    mic_device: str
    speaker_device: str
    max_record_seconds: int

    face_model: Path
    camera_vflip: bool
    camera_fps: int
    tracking_autostart: bool

    tts_engine: str
    tts_voice: str
    tts_speed: float
    tts_steps: int
    tts_cache_dir: str
    tts_lang: str

    extra: dict[str, str] = field(default_factory=dict)

    @property
    def recordings_dir(self) -> Path:
        """Directory holding captured wav files."""
        return self.data_dir / "recordings"

    @property
    def settings_path(self) -> Path:
        """File backing the runtime-mutable settings (camera flip, tracking)."""
        return self.data_dir / "capd-settings.json"


def load_config() -> Config:
    """Build a :class:`Config` from the current environment."""
    data_dir = Path(
        env_str("CAP_DATA_DIR", default=str(Path.home() / ".cap"))
    ).expanduser()

    return Config(
        mock=env_bool("CAP_HW_MOCK"),
        host=env_str("CAPD_HOST", default="127.0.0.1"),
        port=env_int("CAPD_PORT", default=8790),
        data_dir=data_dir,
        serial_port=env_str("CAP_SERIAL_PORT", default="/dev/ttyUSB0"),
        serial_baud=env_int("CAP_SERIAL_BAUD", default=115200),
        mic_device=env_str("CAP_MIC_DEVICE", default="plughw:CARD=Device,DEV=0"),
        speaker_device=env_str("CAP_SPEAKER_DEVICE", default="default"),
        max_record_seconds=env_int("CAP_MAX_RECORD_SECONDS", default=120),
        face_model=Path(
            env_str("CAP_FACE_MODEL", default=str(DEFAULT_FACE_MODEL))
        ).expanduser(),
        camera_vflip=env_bool("CAP_CAMERA_VFLIP"),
        camera_fps=env_int("CAP_CAMERA_FPS", default=15),
        tracking_autostart=env_bool("CAP_TRACKING_AUTOSTART", default=True),
        tts_engine=env_str("CAP_TTS", default="supertonic").lower(),
        tts_voice=env_str("SUPERTONIC_VOICE", default="M1"),
        tts_speed=env_float("SUPERTONIC_SPEED", default=1.05),
        tts_steps=env_int("SUPERTONIC_TOTAL_STEPS", default=8),
        tts_cache_dir=env_str("SUPERTONIC_CACHE_DIR", default=""),
        tts_lang=env_str("CAP_TTS_LANG", default="fr"),
    )
