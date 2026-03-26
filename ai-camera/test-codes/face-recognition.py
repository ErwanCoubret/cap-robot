import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement du modèle dans la caméra (cela peut prendre quelques secondes la 1ère fois)...")
imx500 = IMX500(MODEL_PATH)

# Initialisation de Picamera2
picam2 = Picamera2(imx500.camera_num)

# ✨ L'ASTUCE EST ICI :
# Récupérer la taille d'entrée exacte exigée par le modèle IA
# On récupère toujours la taille attendue par le modèle (généralement 640x640)
model_h, model_w = imx500.get_input_size()

# 1. Le flux principal : Résolution classique (ex: 720p), on laisse le format par défaut (YUV420, beaucoup plus léger)
main_config = {"size": (1280, 720)}

# 2. Le flux IA (lores) : Taille exacte du modèle et format RGB888 exigé par le NPU
lores_config = {"size": (model_w, model_h), "format": "RGB888"}

# On assemble la configuration
config = picam2.create_preview_configuration(
    main=main_config, 
    lores=lores_config, 
    controls={"FrameRate": 30}
)
picam2.configure(config)

picam2.start()
print("Caméra IA démarrée ! Analyse en cours... (Ctrl+C pour quitter)")

try:
    while True:
        metadata = picam2.capture_metadata()
        
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