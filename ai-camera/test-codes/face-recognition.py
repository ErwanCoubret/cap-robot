import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement du modèle dans la caméra...")
imx500 = IMX500(MODEL_PATH)
picam2 = Picamera2(imx500.camera_num)

# ✨ LA CONFIGURATION HEADLESS ÉPURÉE
# On demande un simple flux vidéo léger pour maintenir le capteur actif. 
# Pas besoin de lores, l'IMX500 s'occupe de l'IA tout seul !
config = picam2.create_video_configuration(
    main={"size": (640, 480), "format": "YUV420"}
)

# On applique la configuration (sans forcer le FrameRate)
picam2.configure(config)
picam2.start()
print("Caméra IA démarrée ! Analyse en cours... (Ctrl+C pour quitter)")

try:
    while True:
        metadata = picam2.capture_metadata()
        
        print(metadata.keys())
        
        # Le reste de ton code...
        detections = metadata.get('ObjectDetect', []) 
        
        cibles = [d for d in detections if d.category == 0 and d.conf > 0.50]
        
        if cibles:
            cible_principale = max(cibles, key=lambda d: d.box.width * d.box.height)
            box = cible_principale.box
            cx = box.x + (box.width / 2)
            cy = box.y + (box.height / 2)
            print(f"🎯 Cible verrouillée - Centre X: {cx:.3f}, Y: {cy:.3f} | Confiance: {cible_principale.conf*100:.1f}%")
        
        time.sleep(0.03)

except KeyboardInterrupt:
    print("\nArrêt demandé par l'utilisateur.")
finally:
    picam2.stop()
    picam2.close()