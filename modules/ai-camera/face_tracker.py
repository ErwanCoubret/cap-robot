#!/usr/bin/env python3
"""Suivi de visage sur l'AI Camera IMX500 -> envoi de la cible a l'ESP32.

Le NPU du capteur execute YOLOv8n-face (lindevs), converti au format IMX500.
Le modele integre deja le NMS : la sortie est une liste de boites triees par
confiance. On garde la plus grande (la personne la plus proche), on projette
son centre sur l'ecran rond GC9A01 (240x240) et on envoie "x,y\\n" sur le port
serie a 115200 bauds.

Le debit serie est volontairement bride : l'ESP32 lit une ligne par boucle de
rendu, le noyer de messages ferait deborder son buffer de reception.
"""

import argparse
import signal
import sys
import time
from pathlib import Path

import serial
from picamera2 import Picamera2
from picamera2.devices import IMX500

# Chemin deduit de l'emplacement du script : il survit ainsi aux
# reorganisations de l'arborescence et aux clones ailleurs que dans ~/cap-robot.
MODEL_RPK = str(
    Path(__file__).resolve().parent
    / "models"
    / "yolov8n-face-lindevs_imx_model"
    / "rpk"
    / "network.rpk"
)

# Ecran rond GC9A01 pilote par eyes_serial.ino
SCREEN = 240
CENTER = SCREEN // 2

# Le modele recoit une image carree 640x640 : la frame 640x480 y est centree
# entre deux bandes noires. Les boites sortent en pixels absolus dans cet
# espace carre, au format [x0, y0, x1, y1] -- et non dans la convention
# (y, x) de picamera2, d'ou la conversion manuelle plutot que
# convert_inference_coords().
MODEL_SIDE = 640

# Cadence d'envoi serie. 20 Hz suffit : le firmware lisse lui-meme le
# deplacement (SMOOTHING = 0.08).
SEND_INTERVAL = 0.05

# Au-dela de ce delai sans visage, l'oeil revient au centre.
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


def best_face(imx500, metadata, threshold):
    """Retourne la boite [x0, y0, x1, y1] du visage le plus grand."""
    outputs = imx500.get_outputs(metadata, add_batch=True)
    if outputs is None:
        return None

    boxes, scores = outputs[0][0], outputs[1][0]

    best = None
    best_area = 0.0
    for box, score in zip(boxes, scores):
        if float(score) < threshold:
            # Les boites sont triees par confiance : la suite est sous le seuil.
            break
        x0, y0, x1, y1 = (float(v) for v in box)
        area = (x1 - x0) * (y1 - y0)
        if area > best_area:
            best_area = area
            best = (x0, y0, x1, y1)
    return best


def to_screen(box, frame_w, frame_h):
    """Projette le centre du visage sur l'ecran, en miroir horizontal.

    Le miroir rend le suivi naturel : quand la personne va vers sa droite,
    l'oeil regarde du meme cote qu'elle depuis son point de vue.
    """
    x0, y0, x1, y1 = box

    # Retrait des bandes de letterbox avant la normalisation.
    pad_x = (MODEL_SIDE - frame_w * MODEL_SIDE / max(frame_w, frame_h)) / 2
    pad_y = (MODEL_SIDE - frame_h * MODEL_SIDE / max(frame_w, frame_h)) / 2
    span_x = MODEL_SIDE - 2 * pad_x
    span_y = MODEL_SIDE - 2 * pad_y

    cx = ((x0 + x1) / 2 - pad_x) / span_x
    cy = ((y0 + y1) / 2 - pad_y) / span_y

    sx = int((1.0 - cx) * SCREEN)
    sy = int(cy * SCREEN)
    return max(0, min(SCREEN, sx)), max(0, min(SCREEN, sy))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/ttyUSB0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--model", default=MODEL_RPK)
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--fps", type=int, default=15,
                        help="cadence capteur, volontairement basse pour limiter la chauffe")
    parser.add_argument("--no-serial", action="store_true",
                        help="affiche les coordonnees sans ouvrir le port serie")
    parser.add_argument("--verbose", action="store_true")
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

    imx500 = IMX500(args.model)
    picam2 = Picamera2(imx500.camera_num)
    picam2.configure(picam2.create_preview_configuration(
        controls={"FrameRate": args.fps}, buffer_count=8
    ))
    # Le premier demarrage televerse ~3 Mo de firmware reseau dans le capteur.
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

            box = best_face(imx500, metadata, args.threshold)
            if box is not None:
                last_seen = now
                centered = False
                point = to_screen(box, frame_w, frame_h)
            elif not centered and now - last_seen > IDLE_TIMEOUT:
                # Plus de visage : on recentre une seule fois puis on se tait.
                point = (CENTER, CENTER)
                centered = True
            else:
                continue

            if now - last_send < SEND_INTERVAL:
                continue
            if point == last_point and now - last_send < IDLE_TIMEOUT:
                continue

            line = f"{point[0]},{point[1]}\n"
            if ser is not None:
                try:
                    ser.write(line.encode())
                except serial.SerialTimeoutException:
                    # L'ESP32 ne consomme plus : on saute la trame plutot que
                    # de bloquer la boucle de capture.
                    print("Ecriture serie en timeout, trame ignoree", file=sys.stderr)
                if args.verbose:
                    print(line.strip())
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
