# Cap robot — architecture

How the robot is put together, and why. For the hardware itself, see the root
[README](../README.md).

## Three processes

```
cap-kiosk.service        cap-ui.service                      capd.service
┌───────────────┐  http ┌──────────────────────┐   http    ┌──────────────────┐
│ Chromium      │ ────► │ Next.js (ui-cap)     │ ────────► │ capd (Python)    │
│ --kiosk       │ ◄──── │  presentation        │ ◄──────── │ 127.0.0.1:8790   │
│ 800x480 touch │  SSE  │  core (domain/uc)    │    WS     │  CameraService   │
│               │ ◄─────┤ /api/camera/preview  │◄──MJPEG───┤   ├ IMX500 owner │
└───────────────┘       │  infrastructure      │           │   ├ detections   │
                        │   ├ mcpClient ───────┼─► Flots   │   └ preview      │
                        │   ├ oauth (PKCE)     │    MCP    │  EyesBus ────────┼─► ESP32
                        │   ├ llm ─────────────┼─► Ollama  │  arecord/aplay   │
                        │   ├ stt ─────────────┼─► local   │  Supertonic TTS  │
                        │   └ jsonStore        │   or OVH  └──────────────────┘
                        └──────────────────────┘
```

**`capd`** owns every physical device. The IMX500 sensor and the ESP32 serial
port each accept exactly one owner, so the daemon is that owner and everything
else goes through its API. It binds to localhost only.

**`ui-cap`** owns the interface, the agent and all persistent state. It is the
daemon's only client.

**The kiosk** is a browser in full screen. It holds no state: it renders what
the server sends and posts back what the user taps.

## Rules that shaped the design

- **One owner per device.** A single capture loop feeds both the face tracker
  and the preview stream. The sensor is acquired when either needs it and
  released as soon as neither does.
- **One writer on the eyes.** The firmware reads one line per render loop;
  flooding it overflows its buffer and the eye freezes. Tracking coordinates
  are coalesced to the newest one and capped at 20 Hz, and expressions take an
  exclusive lease while they play.
- **Missing hardware is a normal state.** Every capability is probed at boot.
  A robot with no camera, no speaker, or no daemon at all still runs and says
  what is missing.
- **State flows one way.** Commands are POSTs that return immediately; the
  screen updates from a single server-sent event stream. A client that connects
  late is told the current state, including a ringing alarm.
- **Nothing important lives only in RAM.** Alarms, the day snapshot, the Flots
  token and what Cap has already announced are JSON files written atomically —
  the robot gets unplugged.

## Layout

```
capd/                      Python hardware daemon
  capd/hardware/           camera, eyes serial link, audio, TTS  (real + mock)
  capd/vision/             geometry, capture loop, tracker, preview
  capd/services/           recorder, speech queue, sounds, expressions
  capd/api/                HTTP routes and the event WebSocket
ui-cap/
  core/domain/             types with no dependencies
  core/ports/              interfaces the use cases depend on
  core/usecases/           agent, voice, alarms, day sync, proactive rules
  infrastructure/          MCP, OAuth, AI providers, capd client, JSON stores
  presentation/            React components, hooks, the client container
  app/                     routes only — thin adapters over the above
deploy/                    systemd units, kiosk launcher, installer
modules/                   hardware bring-up scripts and ESP32 firmware
```

`modules/` is the bring-up work the daemon grew out of. Those scripts still run
standalone for debugging, but **stop `capd` first** — it holds the camera and
the serial port.

## Flots

Access goes through the MCP server over OAuth 2.1 with PKCE. The robot
registers itself as a public client, the user grants access on the Flots
consent screen, and the token is stored with owner-only permissions.

Cap asks for read and write on tasks and notes, and nothing else. Flots also
offers delete scopes; a device sitting in a shared room has no business holding
a credential that can wipe someone's work — and the agent refuses those tools
even if a model asks for one.

There is no refresh grant, so the 30-day token eventually expires. That is not
treated as an error: the robot warns a few days ahead, says so on screen when
it happens, and re-pairing is one button.

## AI

Everything speaks the OpenAI API, so one client shape covers the local Ollama
box, the local speech model, and the hosted fallbacks. The provider is chosen
explicitly and validated at boot; an unrecognised name fails loudly rather than
falling back, and with nothing configured transcription is simulated and says
so. Speech synthesis is always local.

## Daemon API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/status` | capabilities and live state of every service |
| `GET` | `/health` | liveness |
| `POST` | `/tracking/start` · `/tracking/stop` | follow faces with the eyes |
| `GET` | `/camera/preview` | MJPEG stream (starts the sensor on demand) |
| `GET` | `/camera/snapshot` | one frame |
| `POST` | `/camera/settings` | vertical flip, tracking on/off |
| `POST` | `/record/start` · `/record/stop` · `/record/cancel` | voice capture |
| `GET` | `/record/{id}/file` | the captured wav |
| `POST` | `/speak` · `/speak/stop` · `/sound` | voice and notification sounds |
| `POST` | `/eyes/expression` | named eye animation |
| `WS` | `/events` | `hello`, `face`, `camera`, `tracking`, `recording`, `speaking` |

## Running it

On the robot:

```bash
./deploy/install.sh
systemctl status capd cap-ui cap-kiosk
```

On any machine, with no hardware at all:

```bash
# Terminal 1 — the daemon, with every device simulated
cd capd && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
CAP_HW_MOCK=1 .venv/bin/python -m capd

# Terminal 2 — the interface
cd ui-cap && pnpm install && pnpm dev
```

The mock camera produces a face that moves and periodically leaves the frame,
the mock microphone records for as long as you actually hold the button, and
the mock voice waits the time the sentence would really take — so the interface
behaves as it does on the robot.

## Tests

```bash
cd capd   && .venv/bin/python -m pytest    # geometry, serial arbitration, services
cd ui-cap && pnpm test                     # agent loop, MCP parsing, alarms, sync
cd ui-cap && pnpm typecheck && pnpm build
```

## Not here yet

- **Servos.** The neck is not wired up; the capability slot exists and reports
  `false`. Face tracking currently moves the eyes only.
- **Local speech to text.** The provider is in place and needs only a base URL
  once the model is installed.
- **Richer eye expressions.** The firmware protocol carries a pupil coordinate,
  so an expression is a choreography of positions. Eyelids and colours would
  need a firmware opcode.
