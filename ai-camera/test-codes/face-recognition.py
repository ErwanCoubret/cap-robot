import time
import numpy as np
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500, postprocess_yolov8_detection

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement IMX500...")
imx500 = IMX500(MODEL_PATH)

picam2 = Picamera2(imx500.camera_num)
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"})
picam2.configure(config)
picam2.start()

print("🎯 C'est parti ! Analyse des Arrays Numpy en cours...")

try:
    while True:
        metadata = picam2.capture_metadata()
        raw_tensor = metadata.get('CnnOutputTensor')
        
        # raw_tensor doit être un Tuple de 2 arrays (le 'outputs' attendu)
        if raw_tensor is not None and isinstance(raw_tensor, tuple):
            
            # On utilise le nom exact : 'conf'
            # La fonction renvoie : (boxes, scores, ids)
            boxes, scores, ids = postprocess_yolov8_detection(raw_tensor, conf=0.4)
            
            # Si on a des détections (scores n'est pas vide)
            if scores is not None and len(scores) > 0:
                # On trouve l'indice du meilleur score
                i = np.argmax(scores)
                
                # Les coordonnées YOLO sont souvent [x1, y1, x2, y2]
                # ou [x_center, y_center, w, h] selon le firmware.
                # Testons le format standard [x1, y1, x2, y2] :
                box = boxes[i]
                x1, y1, x2, y2 = box[0], box[1], box[2], box[3]
                
                # Calcul du centre
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2
                
                print(f"🎯 VISAGE ! X: {cx:.3f} Y: {cy:.3f} | Confiance: {scores[i]*100:.1f}%")
        
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()