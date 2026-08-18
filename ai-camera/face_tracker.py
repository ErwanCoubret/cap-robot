#!/usr/bin/env python3
"""Suivi de personne sur l'AI Camera IMX500 -> envoi de la cible a l'ESP32.

Le NPU du capteur execute SSD MobileNetV2 (COCO). On garde la classe 0
("person"), on isole la boite la plus grande, et on estime la position de la
tete dans le haut de cette boite. Le point obtenu est projete sur l'ecran rond
GC9A01 (240x240) puis envoye en "x,y\\n" sur le port serie a 115200 bauds.

Le protocole serie est volontairement minimal et debite lentement : l'ESP32
lit une ligne par boucle de rendu, le noyer de messages ferait deborder son
buffer de reception.
"""

import argparse
import signal
import sys
import time

import serial
from picamera2 import Picamera2
from picamera2.devices import IMX500
from picamera2.devices.imx500 import NetworkIntrinsics

MODEL_PATH = "/usr/share/imx500-models/imx500_network_ssd_mobilenetv2_fpnlite_320x320_pp.rpk"

# Ecran rond GC9A01 pilote par eyes_serial.ino
SCREEN = 240
CENTER = SCREEN // 2

PERSON_CLASS = 0

# La boite englobe tout le corps : la tete se situe dans le premier sixieme.
HEAD_Y_RATIO = 0.15

# Cadence d'envoi serie. 20 Hz suffit largement pour l'oeil, qui lisse
# lui-meme le deplacement (SMOOTHING = 0.08 cote firmware).
SEND_INTERVAL = 0.05

# Au-dela de ce delai sans detection, l'oeil revient au centre.
IDLE_TIMEOUT = 1.5

running = True


def stop(_signum, _frame):
    global running
    running = False


def open_serial(port, baud):
    """Ouvre le port et laisse l'ESP32 finir son boot.

    Les cartes a CH340 redemarrent quand l'hote asserte DTR/RTS a l'ouverture :
    ecrire immediatement enverrait les coordonnees dans le vide.
    """
    ser = serial.Serial(port, baud, timeout=1, write_timeout=1)
    time.sleep(2.0)
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    return ser


def best_person(imx500, picam2, metadata, threshold):
    """Retourne la boite pixel (x, y, w, h) de la personne la plus proche."""
    outputs = imx500.get_outputs(metadata, add_batch=True)
    if outputs is None:
        return None

    boxes, scores, classes = outputs[0][0], outputs[1][0], outputs[2][0]

    best = None
    best_area = 0.0
    for box, score, category in zip(boxes, scores, classes):
        if int(category) != PERSON_CLASS or float(score) < threshold:
            continue
        # convert_inference_coords gere l'ordre des coordonnees et le recadrage
        # applique par l'ISP : on evite de reimplementer cette conversion.
        x, y, w, h = imx500.convert_inference_coords(box, metadata, picam2)
        area = w * h
        if area > best_area:
            best_area = area
            best = (x, y, w, h)
    return best


def to_screen(box, frame_w, frame_h):
    """Projette la tete de `box` sur l'ecran, en miroir horizontal.

    Le miroir rend le suivi naturel : quand la personne va vers sa droite,
    l'oeil regarde du meme cote qu'elle depuis son point de vue.
    """
    x, y, w, h = box
    cx = (x + w / 2.0) / frame_w
    cy = (y + h * HEAD_Y_RATIO) / frame_h

    sx = int((1.0 - cx) * SCREEN)
    sy = int(cy * SCREEN)
    return max(0, min(SCREEN, sx)), max(0, min(SCREEN, sy))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/ttyUSB0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--fps", type=int, default=15,
                        help="cadence capteur, volontairement basse pour limiter la chauffe")
    parser.add_argument("--no-serial", action="store_true",
                        help="affiche les coordonnees sans ouvrir le port serie")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    ser = None
    if not args.no_serial:
        try:
            ser = open_serial(args.port, args.baud)
        except serial.SerialException as exc:
            print(f"Port serie indisponible ({args.port}) : {exc}", file=sys.stderr)
            return 1
        print(f"Serie ouverte sur {args.port} a {args.baud} bauds")

    imx500 = IMX500(MODEL_PATH)
    intrinsics = imx500.network_intrinsics or NetworkIntrinsics()
    if intrinsics.task != "object detection":
        print(f"Modele inattendu sur le capteur : {intrinsics.task}", file=sys.stderr)
        return 1

    picam2 = Picamera2(imx500.camera_num)
    config = picam2.create_preview_configuration(
        controls={"FrameRate": args.fps}, buffer_count=8
    )
    picam2.configure(config)
    # Le premier demarrage televerse ~3.8 Mo de firmware reseau dans le capteur.
    imx500.show_network_fw_progress_bar()
    picam2.start()
    frame_w, frame_h = picam2.camera_configuration()["main"]["size"]
    print(f"Camera active ({frame_w}x{frame_h}). Ctrl+C pour quitter.")

    last_send = 0.0
    last_seen = 0.0
    last_point = None
    centered = False

    try:
        while running:
            metadata = picam2.capture_metadata()
            now = time.monotonic()

            box = best_person(imx500, picam2, metadata, args.threshold)
            if box is not None:
                last_seen = now
                centered = False
                point = to_screen(box, frame_w, frame_h)
            elif not centered and now - last_seen > IDLE_TIMEOUT:
                # Personne en vue : on recentre une seule fois puis on se tait.
                point = (CENTER, CENTER)
                centered = True
            else:
                continue

            if point == last_point and now - last_send < IDLE_TIMEOUT:
                continue
            if now - last_send < SEND_INTERVAL:
                continue

            line = f"{point[0]},{point[1]}\n"
            if ser is not None:
                try:
                    ser.write(line.encode())
                except serial.SerialTimeoutException:
                    # L'ESP32 ne consomme plus : on saute la trame plutot que
                    # de bloquer la boucle de capture.
                    print("Ecriture serie en timeout, trame ignoree", file=sys.stderr)
            else:
                print(line.strip())

            last_point = point
            last_send = now
    finally:
        picam2.stop()
        picam2.close()
        if ser is not None and ser.is_open:
            ser.close()
        print("Arret propre.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
