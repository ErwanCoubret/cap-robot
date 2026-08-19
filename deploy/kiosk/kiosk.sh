#!/usr/bin/env bash
#
# Launch the robot's interface full screen on the 800x480 panel.
#
# Everything here exists because this display is unattended: no screen blanking,
# no cursor, no restore-session prompt after a power cut, and no way for a stray
# tap to leave the browser somewhere the user cannot get back from.

set -euo pipefail

URL="${CAP_KIOSK_URL:-http://localhost:3000}"
PROFILE="${CAP_KIOSK_PROFILE:-$HOME/.cap-kiosk}"

log() { echo "[kiosk] $*"; }

# Pick whichever browser this image ships.
BROWSER=""
for candidate in chromium chromium-browser google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BROWSER="$candidate"
    break
  fi
done

if [ -z "$BROWSER" ]; then
  log "no chromium found; install it with: sudo apt install -y chromium"
  exit 1
fi

# Wait for the interface rather than failing: on a cold boot the browser is
# usually ready before the Node server is.
log "waiting for $URL"
for _ in $(seq 1 60); do
  if curl --silent --fail --max-time 2 --output /dev/null "$URL"; then
    break
  fi
  sleep 2
done

# No blanking, no screensaver, no power management: the panel is the robot's
# face and it should always be on.
if command -v xset >/dev/null 2>&1; then
  xset s off || true
  xset s noblank || true
  xset -dpms || true
fi

# Hide the mouse pointer, which otherwise sits in the middle of the screen.
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root &
fi

# A crash or power cut must not leave the "restore pages?" bar on screen.
if [ -f "$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' \
    "$PROFILE/Default/Preferences" || true
fi

log "starting $BROWSER"
exec "$BROWSER" \
  --kiosk \
  --app="$URL" \
  --user-data-dir="$PROFILE" \
  --window-size=800,480 \
  --window-position=0,0 \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --password-store=basic
