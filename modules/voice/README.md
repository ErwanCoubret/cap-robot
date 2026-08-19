# Voice

Audio input/output for the robot. Mic is wired and verified; speaker is TBD
(see root [README.md](../../README.md)).

| Hardware | Role | Interface |
| --- | --- | --- |
| AGPTEK AC02B (lapel mic) | Audio input | USB |
| Speaker (TBD) | Audio output | not yet connected |

---

## 1. Verify the mic is detected

```bash
arecord -l
```

Expected: a USB card, e.g.

```
card 2: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]
```

If nothing lists, it's a USB/cable problem — nothing downstream can work.

List the ALSA device names actually usable with `-D`:

```bash
arecord -L
```

The one to use is `plughw:CARD=Device,DEV=0` (handles sample-rate/format
conversion; `hw:...` is stricter and can reject formats the app requests).

---

## 2. Check gain and mute state

```bash
amixer -c 2 contents
```

(replace `2` with the card number from `arecord -l`)

Reference state on this robot:

| Control | Value |
| --- | --- |
| `Mic Capture Switch` | `on` |
| `Mic Capture Volume` | `16` (max, 23.81dB) |
| `Auto Gain Control` | `on` |

If the switch is off or volume is 0, set it:

```bash
amixer -c 2 sset 'Mic' 16 unmute
```

---

## 3. Record a test clip

```bash
arecord -D plughw:CARD=Device,DEV=0 -f S16_LE -r 16000 -d 4 /tmp/mictest.wav
```

`-d 4` is the duration in seconds. Play it back on the Pi (if a speaker is
connected) with:

```bash
aplay /tmp/mictest.wav
```

### Check it actually captured signal, not silence

A clip can be zero-length-valid but pure noise floor if the mic is unplugged
at the connector, muted, or facing away. Check peak/RMS instead of trusting
the recording completed without error:

```bash
python3 test-codes/record_test.py --seconds 4
```

Talk or clap when it says to. Output:

```
peak=<n> rms=<n> (max=32767)
```

Peak below ~300 with someone actively talking near the mic means no usable
signal — check placement, gain (section 2), or cable, in that order.

---

## 4. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `arecord -l` shows no card | USB mic unplugged or dead cable |
| `arecord` exits with `No such device` | Wrong `-D` value — re-check `arecord -L` |
| Recording succeeds but peak stays near 0 while talking | Mic muted (`Mic Capture Switch`) or gain at 0 |
| Peak is low but not zero, room is quiet | Normal — ambient noise floor, not a fault |
| `Device or resource busy` | Another process holds the device — `fuser /dev/snd/*` to find it |

---

## 5. Verified state

Measured on this robot (Raspberry Pi 5, `cap@192.168.10.127`):

- Mic enumerated: `card 2: Device [USB PnP Sound Device], device 0: USB Audio`
- `Mic Capture Switch: on`, `Mic Capture Volume: 16` (max), `Auto Gain Control: on`
- `arecord -D plughw:CARD=Device,DEV=0 ...` records without error, correct
  file size for the requested duration/rate
- Signal level pending a live talk/clap test near the mic to confirm
  capture, beyond ambient-noise-floor readings
