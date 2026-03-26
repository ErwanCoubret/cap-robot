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
        
        if raw_tensor is not None:
            print("--- ANALYSE DU TENSEUR ---")
            print(f"Type global: {type(raw_tensor)}")
            if isinstance(raw_tensor, (tuple, list)):
                print(f"Nombre d'éléments: {len(raw_tensor)}")
                for i, t in enumerate(raw_tensor):
                    if hasattr(t, 'shape'):
                        print(f"  [{i}] Array Shape: {t.shape} | Type: {t.dtype}")
                    else:
                        print(f"  [{i}] Élément sans shape: {t} (Type: {type(t)})")
            
            # On s'arrête après la première analyse pour lire les résultats
            picam2.stop()
            break
        
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()