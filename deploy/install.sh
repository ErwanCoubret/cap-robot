#!/usr/bin/env bash
#
# Install Cap's operating system on a Raspberry Pi.
#
# Safe to run again: every step checks before doing anything, so this doubles
# as the upgrade path after a `git pull`.
#
#   ./deploy/install.sh              # full install
#   ./deploy/install.sh --no-tts     # skip the ~400 MB voice model download
#   ./deploy/install.sh --no-apt     # skip apt, for a machine already prepared

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="${CAP_USER:-$(id -un)}"
WITH_APT=1
WITH_TTS=1
WITH_SERVICES=1

for arg in "$@"; do
  case "$arg" in
    --no-apt) WITH_APT=0 ;;
    --no-tts) WITH_TTS=0 ;;
    --no-services) WITH_SERVICES=0 ;;
    -h | --help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[1;33m! %s\033[0m\n' "$*"; }

step "Cap robot install (repository: $REPO_ROOT, user: $SERVICE_USER)"

# ── System packages ──────────────────────────────────────────────────────────
if [ "$WITH_APT" = 1 ]; then
  step "System packages"
  # picamera2 comes from apt: it is not reliably pip-installable, which is also
  # why the virtualenv below is created with --system-site-packages.
  sudo apt-get update
  sudo apt-get install -y \
    python3-venv python3-pip python3-picamera2 \
    imx500-all alsa-utils ffmpeg \
    chromium unclutter x11-xserver-utils curl git
else
  info "skipped (--no-apt)"
fi

# ── Node ─────────────────────────────────────────────────────────────────────
step "Node.js"
if command -v node >/dev/null 2>&1 && [ "$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')" -ge 20 ]; then
  info "node $(node --version) already installed"
else
  info "installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pnpm >/dev/null 2>&1; then
  info "enabling pnpm through corepack"
  sudo corepack enable
  corepack prepare pnpm@latest --activate
fi
info "pnpm $(pnpm --version)"

# ── Configuration ────────────────────────────────────────────────────────────
step "Configuration"
if [ -f "$REPO_ROOT/.env" ]; then
  info ".env already present, left untouched"
else
  cp "$REPO_ROOT/deploy/env/.env.example" "$REPO_ROOT/.env"
  info "created .env from the example — review it before starting the robot"
fi

DATA_DIR="$(grep -E '^CAP_DATA_DIR=' "$REPO_ROOT/.env" | tail -1 | cut -d= -f2- || true)"
mkdir -p "${DATA_DIR:-$HOME/.cap}"

# ── Hardware daemon ──────────────────────────────────────────────────────────
step "Hardware daemon (capd)"
VENV="$REPO_ROOT/capd/.venv"
if [ ! -d "$VENV" ]; then
  # --system-site-packages so the daemon can see picamera2 from apt.
  python3 -m venv --system-site-packages "$VENV"
  info "created $VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip

EXTRAS="hw"
if [ "$WITH_TTS" = 1 ]; then
  EXTRAS="hw,tts"
fi
"$VENV/bin/pip" install --quiet -e "$REPO_ROOT/capd[$EXTRAS]"
info "installed capd[$EXTRAS]"

if [ "$WITH_TTS" = 1 ]; then
  step "Voice model"
  info "downloading Supertonic (~400 MB, first run only)"
  "$VENV/bin/python" - <<'PY' || warn "voice model download failed; Cap will start silent and retry later"
import os
from supertonic import TTS

cache = os.environ.get("SUPERTONIC_CACHE_DIR")
if cache:
    os.makedirs(cache, exist_ok=True)
TTS(model="supertonic-3", auto_download=True)
print("  voice model ready")
PY
fi

# ── Interface ────────────────────────────────────────────────────────────────
step "Interface (ui-cap)"
cd "$REPO_ROOT/ui-cap"
pnpm install --frozen-lockfile
pnpm build
cd "$REPO_ROOT"

# ── Face detection network ───────────────────────────────────────────────────
step "Face detection network"
RPK="$REPO_ROOT/modules/ai-camera/models/yolov8n-face-lindevs_imx_model/rpk/network.rpk"
if [ -f "$RPK" ]; then
  info "already packed"
elif command -v imx500-package >/dev/null 2>&1; then
  (
    cd "$REPO_ROOT/modules/ai-camera/models/yolov8n-face-lindevs_imx_model"
    imx500-package -i packerOut.zip -o rpk
  )
  info "packed $RPK"
else
  warn "imx500-package not found; face tracking stays off until it is packed"
fi

# ── Services ─────────────────────────────────────────────────────────────────
if [ "$WITH_SERVICES" = 1 ]; then
  step "Services"
  chmod +x "$REPO_ROOT/deploy/kiosk/kiosk.sh"

  for unit in capd cap-ui cap-kiosk; do
    sudo install -m 0644 "$REPO_ROOT/deploy/systemd/$unit.service" \
      "/etc/systemd/system/$unit.service"
    info "installed $unit.service"
  done

  # The units are written for the `cap` user at /home/cap/cap-robot; adjust
  # them in place when the robot is set up elsewhere.
  if [ "$SERVICE_USER" != "cap" ] || [ "$REPO_ROOT" != "/home/cap/cap-robot" ]; then
    sudo sed -i \
      -e "s|/home/cap/cap-robot|$REPO_ROOT|g" \
      -e "s|^User=cap$|User=$SERVICE_USER|" \
      -e "s|^Group=cap$|Group=$SERVICE_USER|" \
      -e "s|/home/cap/.Xauthority|$HOME/.Xauthority|" \
      /etc/systemd/system/capd.service \
      /etc/systemd/system/cap-ui.service \
      /etc/systemd/system/cap-kiosk.service
    info "adjusted units for $SERVICE_USER at $REPO_ROOT"
  fi

  # A stable name for the eyes, so a second USB device cannot steal ttyUSB0.
  if [ ! -f /etc/udev/rules.d/99-cap-eyes.rules ]; then
    echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", SYMLINK+="cap-eyes"' |
      sudo tee /etc/udev/rules.d/99-cap-eyes.rules >/dev/null
    sudo udevadm control --reload-rules || true
    info "added /dev/cap-eyes udev rule"
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable capd.service cap-ui.service cap-kiosk.service
  sudo systemctl restart capd.service cap-ui.service
  info "capd and cap-ui started; the kiosk starts with the desktop session"
fi

step "Done"
cat <<EOF
  Check on things with:
    systemctl status capd cap-ui cap-kiosk
    journalctl -u capd -f
    curl http://127.0.0.1:8790/status

  Then open the robot's screen and pair it with Flots:
    Réglages → Appairer
EOF
