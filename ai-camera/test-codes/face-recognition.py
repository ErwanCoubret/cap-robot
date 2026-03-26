import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500
from picamera2.devices.imx500 import postprocess_yolov8_detection

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement du modèle IMX500...")
imx500 = IMX500(MODEL_PATH)

picam2 = Picamera2(imx500.camera_num)
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"})
picam2.configure(config)
picam2.start()

print("🎯 Tentative finale... Montre-moi ton visage !")

try:
    while True:
        metadata = picam2.capture_metadata()
        raw_tensor = metadata.get('CnnOutputTensor')
        
        if raw_tensor is not None:
            # On utilise 'threshold' qui est le standard le plus courant
            detections = postprocess_yolov8_detection(raw_tensor, threshold=0.4)
            
            if detections and len(detections) > 0:
                # On prend la détection avec la meilleure confiance
                cible = max(detections, key=lambda d: d.conf)
                
                # Coordonnées du centre
                cx = cible.box.x + (cible.box.width / 2)
                cy = cible.box.y + (cible.box.height / 2)
                
                print(f"🎯 VISAGE DÉTECTÉ ! X: {cx:.3f} Y: {cy:.3f} | Confiance: {cible.conf*100:.1f}%")
        
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()