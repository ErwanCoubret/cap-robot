import time
import numpy as np
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

imx500 = IMX500(MODEL_PATH)
picam2 = Picamera2(imx500.camera_num)
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"}, controls={"FrameRate": 10})
picam2.configure(config)
picam2.start()

print("🔍 SCANNER ACTIF. Bouge devant la caméra...")
last_data = None

try:
    while True:
        metadata = picam2.capture_metadata()
        data = metadata.get('CnnOutputTensor')
        
        if data is not None:
            current_data = np.array(data)
            if last_data is not None:
                # On cherche les index où la valeur a changé de plus de 0.05
                diff = np.abs(current_data - last_data)
                indices_qui_bougent = np.where(diff > 0.05)[0]
                
                if len(indices_qui_bougent) > 0:
                    print(f"\n📈 Changement détecté sur {len(indices_qui_bougent)} valeurs !")
                    for idx in indices_qui_bougent[:10]: # On affiche les 10 premiers pour pas flooder
                        print(f"Index [{idx}]: {current_data[idx]:.2f}", end=" | ")
                    print("")
            
            last_data = current_data
        time.sleep(0.1)

except KeyboardInterrupt:
    picam2.stop()
    picam2.close()