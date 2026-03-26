import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

imx500 = IMX500(MODEL_PATH)
picam2 = Picamera2(imx500.camera_num)
# On reste sur 15 FPS pour la stabilité du flux
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"}, controls={"FrameRate": 15})
picam2.configure(config)
picam2.start()

print("🎯 DÉCODAGE ACTIF. Place-toi devant la caméra...")

try:
    while True:
        metadata = picam2.capture_metadata()
        data = metadata.get('CnnOutputTensor')
        
        if data is not None and len(data) == 1801:
            meilleur_score = 0
            cible_x = 0
            cible_y = 0
            
            # On scanne les 300 slots de détection possibles
            for i in range(300):
                # Le score de confiance est dans le bloc qui commence à 1201
                conf = data[1201 + i]
                
                if conf > meilleur_score:
                    meilleur_score = conf
                    # On récupère les coordonnées correspondantes dans les autres blocs
                    # Index 1-300: X | Index 301-600: Y
                    cible_x = data[1 + i]
                    cible_y = data[301 + i]
            
            # On affiche uniquement si la confiance est sérieuse (plus de 50%)
            if meilleur_score > 0.50:
                # Normalisation : on divise par 640 (taille du modèle) pour avoir du 0.0 à 1.0
                cx = cible_x / 640.0
                cy = cible_y / 640.0
                
                print(f"🎯 VISAGE ! X: {cx:.3f} Y: {cy:.3f} | Confiance: {meilleur_score*100:.1f}%")
            else:
                # print("Recherche...") # Optionnel pour voir si la boucle tourne
                pass
                
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()