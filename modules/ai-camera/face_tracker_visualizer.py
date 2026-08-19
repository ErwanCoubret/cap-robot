#!/usr/bin/env python3
"""Apercu 240x240 de ce que voit le robot, avec un point rouge sur le visage.

Meme detection et meme sortie serie que face_tracker.py : l'oeil bouge
normalement, et la fenetre montre en parallele ce qui a decide de sa position.
La fenetre fait la taille exacte de l'ecran de l'oeil (240x240) et le point
rouge est dessine aux coordonnees reellement transmises, donc s'il tombe sur le
visage, le mapping est bon.

A lancer depuis le bureau du Raspberry Pi, ou en SSH avec DISPLAY=:0.
"""

import argparse
import sys
import time

import cv2
import serial
from picamera2 import Picamera2
from picamera2.devices import IMX500

from face_tracker import (
    IDLE_TIMEOUT,
    MODEL_RPK,
    MODEL_SIDE,
    SCREEN,
    SEND_INTERVAL,
    best_face,
    open_serial,
    to_screen,
)

WINDOW = "cap-robot - face tracker"

RED = (0, 0, 255)      # BGR
GREEN = (0, 255, 0)
GREY = (90, 90, 90)

CENTER = SCREEN // 2


def draw_overlay(view, point, box, frame_w, frame_h, fps, score):
    """Dessine le cadre du visage, le point cible et l'etat courant."""
    # Le contour de l'ecran rond : hors de ce cercle, l'oeil ne peut pas
    # regarder, le firmware ramene la pupille sur le bord.
    cv2.circle(view, (SCREEN // 2, SCREEN // 2), SCREEN // 2 - 1, GREY, 1)

    if box is not None:
        # La boite est en pixels dans le carre 640x640 du modele : on retire
        # le letterbox puis on ramene a l'echelle de l'apercu.
        pad_y = (MODEL_SIDE - frame_h * MODEL_SIDE / max(frame_w, frame_h)) / 2
        pad_x = (MODEL_SIDE - frame_w * MODEL_SIDE / max(frame_w, frame_h)) / 2
        span_x = MODEL_SIDE - 2 * pad_x
        span_y = MODEL_SIDE - 2 * pad_y

        x0, y0, x1, y1 = box
        # L'apercu est en miroir : les bords gauche et droit s'echangent.
        left = SCREEN - int((x1 - pad_x) / span_x * SCREEN)
        right = SCREEN - int((x0 - pad_x) / span_x * SCREEN)
        top = int((y0 - pad_y) / span_y * SCREEN)
        bottom = int((y1 - pad_y) / span_y * SCREEN)
        cv2.rectangle(view, (left, top), (right, bottom), GREEN, 1)
        cv2.putText(view, f"{score:.2f}", (left, max(10, top - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, GREEN, 1, cv2.LINE_AA)

    if point is not None:
        cv2.circle(view, point, 5, RED, -1)
        cv2.circle(view, point, 7, RED, 1)

    label = f"{fps:4.1f} fps" if point is None else f"{fps:4.1f} fps  {point[0]},{point[1]}"
    cv2.putText(view, label, (4, SCREEN - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1, cv2.LINE_AA)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=MODEL_RPK)
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--scale", type=int, default=1,
                        help="agrandit la fenetre sans changer les coordonnees")
    parser.add_argument("--port", default="/dev/ttyUSB0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--no-serial", action="store_true",
                        help="apercu seul, sans piloter l'oeil")
    args = parser.parse_args()

    ser = None
    if not args.no_serial:
        try:
            ser = open_serial(args.port, args.baud)
            print(f"Serie ouverte sur {args.port} a {args.baud} bauds")
        except serial.SerialException as exc:
            # L'apercu reste utile sans ESP32 : on continue sans piloter l'oeil.
            print(f"Port serie indisponible ({args.port}) : {exc}", file=sys.stderr)

    imx500 = IMX500(args.model)
    picam2 = Picamera2(imx500.camera_num)
    picam2.configure(picam2.create_preview_configuration(
        main={"size": (640, 480), "format": "RGB888"},
        controls={"FrameRate": args.fps},
        buffer_count=8,
    ))
    imx500.show_network_fw_progress_bar()
    picam2.start()
    frame_w, frame_h = picam2.camera_configuration()["main"]["size"]
    print(f"Camera active ({frame_w}x{frame_h}). 'q' ou Echap pour quitter.")

    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW, SCREEN * args.scale, SCREEN * args.scale)

    last = time.monotonic()
    fps = 0.0
    last_send = 0.0
    last_seen = 0.0
    last_point = None
    centered = False

    try:
        while True:
            request = picam2.capture_request()
            try:
                frame = request.make_array("main")
                metadata = request.get_metadata()
            finally:
                # Rendre le buffer tout de suite : le garder plus longtemps
                # affame la file de capture et fait chuter la cadence.
                request.release()

            box = best_face(imx500, metadata, args.threshold)
            score = 0.0
            if box is not None:
                outputs = imx500.get_outputs(metadata, add_batch=True)
                score = float(outputs[1][0][0])

            now = time.monotonic()
            fps = 0.9 * fps + 0.1 / max(now - last, 1e-6)
            last = now

            # L'apercu est ecrase dans un carre 240x240 : c'est exactement la
            # deformation que subissent les coordonnees envoyees a l'oeil, donc
            # le point rouge tombe au bon endroit.
            view = cv2.resize(frame, (SCREEN, SCREEN), interpolation=cv2.INTER_AREA)
            # Miroir, comme un selfie : bouger a droite deplace l'image a
            # droite. C'est aussi le repere des coordonnees envoyees a l'oeil,
            # donc le point rouge se dessine tel quel.
            view = cv2.flip(view, 1)

            point = None
            if box is not None:
                sx, sy = to_screen(box, frame_w, frame_h)
                last_seen = now
                centered = False
                target = (sx, sy)
                point = (sx, sy)
            elif not centered and now - last_seen > IDLE_TIMEOUT:
                # Plus de visage : on recentre l'oeil une seule fois.
                target = (CENTER, CENTER)
                centered = True
            else:
                target = None

            if ser is not None and target is not None and now - last_send >= SEND_INTERVAL:
                if target != last_point or now - last_send >= IDLE_TIMEOUT:
                    try:
                        ser.write(f"{target[0]},{target[1]}\n".encode())
                    except serial.SerialTimeoutException:
                        # L'ESP32 ne consomme plus : on saute la trame plutot
                        # que de bloquer l'apercu.
                        print("Ecriture serie en timeout, trame ignoree", file=sys.stderr)
                    last_point = target
                    last_send = now

            draw_overlay(view, point, box, frame_w, frame_h, fps, score)

            if args.scale != 1:
                view = cv2.resize(view, (SCREEN * args.scale, SCREEN * args.scale),
                                  interpolation=cv2.INTER_NEAREST)
            cv2.imshow(WINDOW, view)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                break
    except KeyboardInterrupt:
        pass
    finally:
        cv2.destroyAllWindows()
        picam2.stop()
        picam2.close()
        if ser is not None and ser.is_open:
            ser.close()
        print("Arret propre.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
