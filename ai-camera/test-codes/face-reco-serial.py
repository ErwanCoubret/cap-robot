import time
import serial
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

# Dimensions de l'écran TFT de l'Arduino (pour la conversion des coordonnées)
TFT_WIDTH = 320
TFT_HEIGHT = 240

# ==========================================
# 1. Configuration du port série USB
# ==========================================
try:
    ser = serial.Serial('/dev/ttyACM0', 9600, timeout=1)
    time.sleep(2) # Pause indispensable pour laisser l'Arduino redémarrer lors de la connexion série
    print("✅ Connexion série établie avec l'Arduino !")
except Exception as e:
    print(f"❌ Erreur de connexion série : {e}")
    print("Vérifie que l'Arduino est branché et que le port est bien /dev/ttyACM0")
    exit()

# ==========================================
# 2. Configuration de l'AI Camera
# ==========================================
# Remplace par ton propre .rpk si tu as converti un modèle YOLO spécifique aux visages
MODEL_PATH = "/usr/share/imx500-models/imx500_network_ssd_mobilenetv2_fpnlite_320x320_pp.rpk"
print("⏳ Chargement du modèle IA dans le capteur...")
imx500 = IMX500(MODEL_PATH)

picam2 = Picamera2(imx500.camera_num)
# On règle la caméra à 30 FPS, bien suffisant pour ce suivi
config = picam2.create_preview_configuration(controls={"FrameRate": 30})
picam2.configure(config)
picam2.start()

print("👀 Caméra active ! Recherche de visages en cours... (Ctrl+C pour quitter)")

try:
    while True:
        # Lecture immédiate du NPU (zéro charge CPU)
        metadata = picam2.capture_metadata()
        detections = metadata.get('ObjectDetect', []) 
        
        # Filtre : on garde la classe 0 (Personne/Visage) avec + de 50% de confiance
        cibles = [d for d in detections if d.category == 0 and d.conf > 0.50]
        
        if cibles:
            # On isole la plus grande bounding box pour cibler la personne la plus proche
            cible_principale = max(cibles, key=lambda d: d.box.width * d.box.height)
            box = cible_principale.box
            
            # Calcul du centre (les valeurs x et y sont entre 0.0 et 1.0)
            cx = box.x + (box.width / 2)
            cy = box.y + (box.height / 2)
            
            # Mapping vers la résolution de l'écran TFT (320x240)
            # ASTUCE MIROIR : On fait (1.0 - cx) pour reproduire ton ancien cv2.flip(frame, 1)
            mapped_x = int((1.0 - cx) * TFT_WIDTH) 
            mapped_y = int(cy * TFT_HEIGHT)
            
            # Sécurité pour ne pas dépasser les bords de l'écran TFT
            mapped_x = max(0, min(TFT_WIDTH, mapped_x))
            mapped_y = max(0, min(TFT_HEIGHT, mapped_y))
            
            # Formatage et envoi sur le port série à l'Arduino
            data = f"{mapped_x},{mapped_y}\n"
            ser.write(data.encode())
            print(f"Position envoyée : {data.strip()}")
        
        # Pause de 50ms (similaire à ton ancien time.sleep(0.05))
        # Très important pour ne pas noyer le buffer série de l'Arduino (9600 bauds c'est lent !)
        time.sleep(0.05)

except KeyboardInterrupt:
    print("\n🛑 Arrêt du script demandé.")
finally:
    # Nettoyage et fermeture propre des connexions
    picam2.stop()
    picam2.close()
    if 'ser' in locals() and ser.is_open:
        ser.close()
    print("Connexions fermées.")