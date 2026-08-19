# AI Camera IMX500

The Sony IMX500 is a camera module with an AI accelerator inside the sensor itself. The neural network runs on the sensor die, so inference costs the
Raspberry Pi almost no CPU: the Pi only reads the resulting tensors out of the
frame metadata.

https://docs.ultralytics.com/fr/integrations/sony-imx500

This directory holds the face tracker that drives the robot's eyes:
camera → face detection on the sensor → screen coordinates → ESP32 over serial.

```
IMX500 sensor            Raspberry Pi 5              ESP32 + GC9A01
[ YOLOv8n-face ]  --->  [ face_tracker.py ]  --->   [ eyes_serial.ino ]
   NPU, ~11 fps          decode + mapping            "x,y\n" @ 115200
```

---

## 1. Install

On the Raspberry Pi 5:

```bash
sudo apt update
sudo apt install -y python3-picamera2 imx500-all imx500-tools python3-opencv
sudo reboot
```

- `imx500-all` pulls in the sensor firmware and the stock model set
- `imx500-tools` provides `imx500-package`, needed to pack a custom model
- `python3-picamera2` is the capture and inference API
- `python3-opencv` is only needed for the visualiser, not for the tracker

`pyserial` ships with Raspberry Pi OS; check with `python3 -c "import serial"`.

> The `modlib` library (`aitrios-rpi-application-module-library`) is **not**
> required. It is a higher-level wrapper; everything here uses `picamera2`
> directly, which is already packaged and avoids a `--break-system-packages`
> pip install.

### Clone the repository on the Pi

```bash
git clone git@github.com:ErwanCoubret/cap-robot.git ~/cap-robot
```

---

## 2. Verify the hardware before running anything

Run these three checks in order. Each one isolates a different failure, so a
red result tells you exactly where to look.

**Camera detected on the CSI bus:**

```bash
rpicam-hello --list-cameras
```

Expected: `0 : imx500 [4056x3040 10-bit RGGB] (/base/axi/pcie@.../imx500@1a)`.
If the camera is missing, it is a cable or power problem — nothing downstream
can work.

**Sensor stack installed:**

```bash
dpkg -l | grep -E "imx500|picamera2"
```

Reference state on this robot:

| Package | Version |
| --- | --- |
| `imx500-all` | 1.12.0-1 |
| `imx500-firmware` | 0.FF23+3 |
| `imx500-models` | 1:1.0.0-1 |
| `imx500-tools` | 0~20241022+2-1+trixie |
| `python3-picamera2` | 0.3.37-1 |

**ESP32 present and writable:**

```bash
ls -l /dev/ttyUSB*
udevadm info -q property -n /dev/ttyUSB0 | grep ID_MODEL_FROM_DATABASE
groups | grep dialout
```

The board uses a CH340 bridge (`1a86:7523`), so it appears as `/dev/ttyUSB0`,
**not** `/dev/ttyACM0`. Your user must be in `dialout`; otherwise:

```bash
sudo usermod -aG dialout $USER   # log out and back in
```

### Check what the camera is actually looking at

Do this before debugging any "the model detects nothing" problem. A model that
returns zero detections because the camera faces a wall looks identical to a
broken model.

```bash
rpicam-jpeg -o /tmp/frame.jpg -t 2000
```

Then open `/tmp/frame.jpg` and confirm a face is in frame.

### Check the serial link on its own

This writes three positions straight to the ESP32, with no camera involved. The
pupil should jump left, right, then back to centre.

```bash
python3 - <<'EOF'
import serial, time
ser = serial.Serial("/dev/ttyUSB0", 115200, timeout=1, write_timeout=1)
time.sleep(2)                     # let the board finish rebooting
for p in ["60,120", "180,120", "120,120"]:
    ser.write((p + "\n").encode())
    print("sent", p)
    time.sleep(1.2)
ser.close()
EOF
```

If nothing moves, the fault is on the ESP32 side (wrong sketch flashed, wrong
baud rate), not on the camera side.

---

## 3. Put the face model on the sensor

The model is [YOLOv8n-face by lindevs](https://github.com/lindevs/yolov8-face),
already exported to IMX format in `models/yolov8n-face-lindevs_imx_model/`.

### Re-exporting from a `.pt` (only if you change the model)

```bash
yolo export model=models/yolov8n-face-lindevs.pt format=imx
```

This runs post-training quantisation and produces a folder containing
`packerOut.zip`, `labels.txt` and `dnnParams.xml`. Export on a desktop, not on
the Pi — it needs PyTorch and the compression toolkit.

`model-creation/model-compression.py` does the same quantisation by hand with
Sony's Model Compression Toolkit, using the photos in `model-creation/images/`
as the calibration set. It is only needed when the Ultralytics export gives
poor accuracy and the calibration data has to match the robot's real scene.

### Pack it into sensor firmware

`packerOut.zip` cannot be loaded directly — it has to become a `.rpk`:

```bash
cd ~/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model
imx500-package -i packerOut.zip -o rpk
```

This writes `rpk/network.rpk` (3.0 MB). Check the memory report next to it:

```json
"Memory Usage": "7,06MB", "Total Memory Available On Chip": "8,00MB",
"Memory Utilization": "89%", "Fit In Chip": true
```

`Fit In Chip: false` means the model is too big for the sensor's 8 MB and will
never load, whatever you do afterwards.

`rpk/` is generated, not committed — regenerate it after every re-export.

---

## 4. Run the tracker

```bash
cd ~/cap-robot

python3 ai-camera/face_tracker.py                  # normal run, /dev/ttyUSB0
python3 ai-camera/face_tracker.py --verbose        # also print what is sent
python3 ai-camera/face_tracker.py --no-serial      # camera only, no ESP32
python3 ai-camera/face_tracker.py --threshold 0.6  # stricter detection
```

The first start uploads ~3 MB of network firmware into the sensor and takes
about 45 seconds, with a progress bar. Later starts reuse it and are fast.

`--no-serial` is the safe way to debug: it prints the coordinates it *would*
send, and never opens the serial port.

### Visualising what the robot sees

`face_tracker_visualizer.py` runs the same detection and drives the eye exactly
like the tracker, but also opens a window the size of the eye screen (240x240)
showing the camera view, the detected face and the position being sent.

```bash
cd ~/cap-robot/ai-camera
python3 face_tracker_visualizer.py --scale 2      # window doubled, eye driven
python3 face_tracker_visualizer.py --no-serial    # preview only
```

`q` or `Esc` quits. The window must be on the Pi's own display; over SSH,
prefix the command with `DISPLAY=:0`.

The preview is mirrored, like a selfie, which puts it in the same frame of
reference as the coordinates sent to the eye — so the red dot is drawn at the
transmitted position directly. If the dot sits on the face, the mapping is
correct. The grey circle marks how far the pupil can actually look: past it,
the firmware clamps to the edge.

Only one process can hold the IMX500 at a time. `Device or resource busy` on
startup means another run is still alive — wait for it, or `pkill -f
face_tracker`.

### Why the rates are capped

The sensor runs at 15 fps and the serial output at 20 Hz on purpose. The ESP32
reads one line per render loop; sending faster overflows its RX buffer and the
eye stutters or freezes. The firmware smooths motion on its side
(`SMOOTHING = 0.08`), so a higher rate would not look better anyway.

When no face has been visible for 1.5 s the tracker sends the centre position
once, then stays quiet until a face returns.

---

## 5. Reading the model output

This is the part that is not documented upstream and cost the most time, so it
is worth writing down.

The Ultralytics IMX export bakes NMS into the network. The sensor returns four
tensors, already sorted by confidence:

| Tensor | Shape | Meaning |
| --- | --- | --- |
| 0 | `(1, 300, 4)` | boxes |
| 1 | `(1, 300)` | scores |
| 2 | `(1, 300)` | class ids (always 0 — single class, `face`) |
| 3 | `(1, 1)` | number of valid detections |

Two traps, both confirmed by overlaying a box on a captured frame:

1. **Boxes are `[x0, y0, x1, y1]`** — not picamera2's usual `(y, x)` ordering.
2. **Boxes are absolute pixels in the model's square 640x640 input.** The
   camera stream is 640x480, so it is letterboxed with 80 px bars top and
   bottom. Subtract the padding before normalising:
   `img_y = box_y - 80`.

Consequently `imx500.convert_inference_coords()` **must not be used here**: it
assumes normalised boxes and returns six-digit garbage. `to_screen()` in
`face_tracker.py` removes the padding and normalises by hand.

The X axis is mirrored on purpose (`1.0 - cx`) so that when the person moves to
their right, the eye looks the same way they do.

---

## 6. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Scores are all exactly `0.0` | No face in frame. Save a JPEG and look at it before suspecting the model. |
| Box values look plausible but scores are 0 | The box tensor shares its `l2Offset` with the input tensor, so it aliases image data. Trust the score, not the box. |
| Coordinates are six digits | `convert_inference_coords()` was used. See section 5. |
| Coordinates are sent but the pupil does not move | ESP32 side: wrong sketch flashed, or wrong baud rate. The sketch must be at 115200 and map to a 240x240 round screen. |
| `Permission denied` on `/dev/ttyUSB0` | User not in `dialout`. |
| Nothing on `/dev/ttyACM0` | Wrong device — the CH340 bridge enumerates as `/dev/ttyUSB0`. |
| `Fit In Chip: false` | Model too large for the sensor's 8 MB. |

---

## 7. Verified state

Measured on this robot (Raspberry Pi 5, `cap@192.168.10.127`):

- Camera enumerated: `imx500 [4056x3040 10-bit RGGB]`
- Face model packed to `network.rpk`, 89% chip memory, `Fit In Chip: true`
- Inference running at ~11 fps, **0.82 confidence on a live face, every frame**
- Serial writes accepted at 115200 baud on `/dev/ttyUSB0`
- Full loop confirmed end to end: camera → detection → mapping → ESP32, with
  the pupil following the face

## References

- [IMX500 converter documentation (Sony AITRIOS)](https://developer.aitrios.sony-semicon.com/en/docs/raspberry-pi-ai-camera/imx500-converter?version=3.14.3&progLang=)
- [Ultralytics IMX500 integration](https://docs.ultralytics.com/integrations/sony-imx500/#software-prerequisites)
