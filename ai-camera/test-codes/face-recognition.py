import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("1. Initialisation du capteur IMX500...")
imx500 = IMX500(MODEL_PATH)

print("2. Configuration de Picamera2 (Mode 15 FPS pour stabilité)...")
picam2 = Picamera2(imx500.camera_num)

# On force un framerate plus bas pour éviter le "Frontend Timeout"
# On utilise une résolution très basse pour le flux principal pour économiser de la bande passante
config = picam2.create_video_configuration(
    main={"size": (640, 480), "format": "YUV420"},
    controls={"FrameRate": 15}
)
picam2.configure(config)

print("3. Démarrage de la caméra...")
picam2.start()

# Petite pause pour laisser le NPU se stabiliser
time.sleep(2)

print("🎯 Robot en ligne ! Cherche des visages...")

try:
    while True:
        # capture_metadata attend qu'un résultat IA soit disponible
        metadata = picam2.capture_metadata()
        data = metadata.get('CnnOutputTensor')
        
        # Structure Lindevs : Tuple de 1801 floats
        if data is not None and len(data) == 1801:
            nb_visages = int(data[0])
            
            if nb_visages > 0:
                # Score de confiance à l'index 1201
                conf = data[1201]
                
                if conf > 0.45:
                    # On récupère X (index 1) et Y (index 301)
                    # Ils sont souvent normalisés entre 0.0 et 1.0
                    cx = data[1]
                    cy = data[301]
                    
                    # Si les valeurs sont > 1.0, on divise par 640 (taille modèle)
                    if cx > 1.0: cx /= 640.0
                    if cy > 1.0: cy /= 640.0
                    
                    print(f"🎯 VISAGE DÉTECTÉ ! X: {cx:.3f} Y: {cy:.3f} | Conf: {conf*100:.1f}%")
        
        # On ne surcharge pas la boucle
        time.sleep(0.01)

except Exception as e:
    print(f"\nUne erreur est survenue : {e}")
except KeyboardInterrupt:
    print("\nArrêt par l'utilisateur.")
finally:
    print("Fermeture propre...")
    picam2.stop()
    picam2.close()