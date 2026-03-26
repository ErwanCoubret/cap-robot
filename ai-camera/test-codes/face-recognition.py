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
        if raw_tensor is not None:
            # ✨ L'ASTUCE : On ne garde que les 2 premiers tenseurs
            # pour éviter le crash "too many values to unpack"
            tensors_to_process = raw_tensor[:2] if isinstance(raw_tensor, tuple) else raw_tensor
            
            try:
                # On appelle la fonction avec nos 2 tenseurs filtrés
                boxes, scores, ids = postprocess_yolov8_detection(tensors_to_process, conf=0.4)
                
                if scores is not None and len(scores) > 0:
                    i = np.argmax(scores)
                    box = boxes[i]
                    
                    # YOLOv8 format : [x1, y1, x2, y2] ou [cx, cy, w, h]
                    # On calcule le centre de la boîte
                    cx = (box[0] + box[2]) / 2
                    cy = (box[1] + box[3]) / 2
                    
                    print(f"🎯 VISAGE ! X: {cx:.3f} Y: {cy:.3f} | Conf: {scores[i]*100:.1f}%")
            
            except Exception as e:
                # Si ça crash encore, on veut savoir exactement pourquoi
                print(f"Erreur lors du traitement : {e}")
        
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()