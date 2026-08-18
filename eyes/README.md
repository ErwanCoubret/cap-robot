# 👁️ Animated Eye Project (ESP32 + Round GC9A01 Display)

This project displays an animated eye (moving pupil + eyelid blinking) on a round GC9A01 TFT LCD screen, driven by an ESP32 microcontroller.

The render engine is optimized for maximum smoothness (60 FPS) with no flicker, while avoiding the memory crashes typical of the ESP32 by using a **Mini-Canvas**.

Two sketches are included:

* **`loop_eyes/`** — standalone demo, pupil cycles through fixed waypoints automatically.
* **`eyes_serial/`** — same render engine, but pupil target is driven live over serial (e.g. from a Raspberry Pi).

---

## 🛠️ Required Hardware

* **1x** ESP32 dev board (30-pin model)
* **1x** 1.28" round TFT LCD screen (GC9A01 driver)
* Jumper wires

---

## 🔌 Wiring (Pinout)

To guarantee max display speed, we use the ESP32's **Hardware SPI**. The screen pins must be connected to the board's dedicated hardware pins:

| GC9A01 Screen Pin | ESP32 Pin (Silkscreen) | Function |
| :--- | :--- | :--- |
| **VCC** | **3V3** | Power (3.3V) |
| **GND** | **GND** | Ground |
| **SCL / SCK** | **D18** | SPI Clock (Hardware SPI) |
| **SDA / MOSI** | **D23** | SPI Data (Hardware SPI) |
| **DC** | **D2** | Data / Command |
| **CS** | **D5** | Chip Select |
| **RST / RES** | **D4** | Reset |
| **BLK / BL** | **3V3** | Backlight (*Required — screen stays black without it*) |

---

## 💻 Setup & Requirements (Arduino IDE)

1. **Board configuration:** In Arduino IDE, select `Tools` > `Board` > **ESP32 Dev Module**.
2. **Required libraries:** Open the Library Manager (`Ctrl+Shift+I` or `Sketch > Include Library > Manage Libraries`) and install:
   * **Adafruit GFX Library**
   * **Adafruit GC9A01A**

---

## 🧠 How the Code Works

* **Hardware SPI:** By declaring only 3 pins (`TFT_CS`, `TFT_DC`, `TFT_RST`) in the display constructor, the ESP32 is forced to use its ultra-fast hardware SPI link (wired to pins D18 and D23).
* **The Mini-Canvas (128x128):** Instead of saturating RAM with a full 240x240 pixel buffer (which causes `StoreProhibited` crashes), a local 32 KB buffer is used around the pupil to erase and redraw movement with zero flicker and no trailing artifacts.
* **Async timers (`millis()`):** The code has no blocking `delay()`. Pupil movement and eyelid blinking run in parallel on independent time intervals.

---

## 📡 Serial Protocol (`eyes_serial`)

Send target pupil coordinates as text over serial, one pair per line:

```
<x>,<y>\n
```

* `x`, `y` are screen coordinates (center is `120,120`).
* If the point falls outside the eye radius, it's automatically clamped back onto the boundary.
* Baud rate: **115200**. At this rate the serial link is not the bottleneck — the SPI render loop is — so 115200 is plenty even for a Raspberry Pi pushing updates at 60-100 Hz.

### Testing from a Raspberry Pi

Find the ESP32's serial port first:

```bash
ls /dev/ttyUSB* /dev/ttyACM*
```

**Option 1 — `screen` (quick, interactive)**
```bash
screen /dev/ttyUSB0 115200
```
Type `120,150` + Enter to send a target. Exit with `Ctrl-A` then `k`, confirm `y`.

**Option 2 — `minicom` (nicer UI)**
```bash
sudo apt install minicom
minicom -D /dev/ttyUSB0 -b 115200
```
Quit with `Ctrl-A` then `X`.

**Option 3 — Python + pyserial (scripted test loop)**
```bash
pip install pyserial
python3 -c "
import serial, time
s = serial.Serial('/dev/ttyUSB0', 115200, timeout=1)
time.sleep(2)  # wait for ESP32 reset after port open
while True:
    s.write(b'120,150\n')
    time.sleep(1)
    s.write(b'60,90\n')
    time.sleep(1)
"
```

> Opening the serial port resets the ESP32 (DTR toggle) — expect a ~1-2s delay before it's ready. It prints `Systeme pret !` once initialized if you read the port back.

---

## ⚙️ Customization

Key parameters can be changed directly in the source code:

* **Colors (RGB565 format):**
  * `COLOR_WHITE` (`0xFFFF`): background / eyeball.
  * `COLOR_PUPIL` (`0x2169`): pupil color (`#232B49`).
  * `COLOR_EYELID` (`0x633F`): eyelid color (`#615FFF`).
* **Animation variables:**
  * `PUPIL_RADIUS`: pupil size (e.g. `60`).
  * `SMOOTHING`: glide smoothness (e.g. `0.08` for a slow, soft movement).
  * `BLINK_INTERVAL`: time between each blink (e.g. `1600` ms).
  * `DELAY_BETWEEN_MOVES` *(loop_eyes only)*: pause between each automatic waypoint change.

---

## 🆘 Troubleshooting

* **Screen stays black:** Check that the **BLK** pin is connected to **3.3V** and that the SPI lines (D18 and D23) are correct.
* **Port-related compile error:** Make sure **ESP32 Dev Module** is selected under Arduino board types.
* **No response from `eyes_serial`:** Confirm the baud rate matches on both ends (115200) and that you're writing to the correct `/dev/ttyUSB*`/`/dev/ttyACM*` device.
