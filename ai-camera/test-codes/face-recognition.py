import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

# 1. Chargement du modèle IA dans le capteur IMX500
# NOTE : Remplace ce chemin par ton modèle de détection de visage spécifique si tu en as compilé un.
# Par défaut, on utilise un modèle standard pré-installé qui détecte les personnes (classe 0).
MODEL_PATH = "/usr/share/imx500-models/imx500_network_ssd_mobilenetv2_fpnlite_320x320_pp.rpk"

print("Chargement du modèle dans la caméra (cela peut prendre quelques secondes la 1ère fois)...")
imx500 = IMX500(MODEL_PATH)

# 2. Initialisation de Picamera2 liée au NPU
picam2 = Picamera2(imx500.camera_num)

# Configuration simple du flux (30 FPS)
config = picam2.create_preview_configuration(controls={"FrameRate": 30})
picam2.configure(config)

picam2.start()
print("Caméra IA démarrée ! Analyse en cours... (Ctrl+C pour quitter)")

try:
    while True:
        # Récupération immédiate des métadonnées (qui contiennent les résultats de l'IA)
        # Contrairement à OpenCV, ici on n'analyse pas l'image, on lit juste la conclusion de l'IA !
        metadata = picam2.capture_metadata()
        
        # Récupération de la liste des objets détectés 
        # (La clé exacte dans le dictionnaire dépend du post-processing du modèle)
        detections = metadata.get('ObjectDetect', []) 
        
        # Filtrer pour ne garder que la classe "visage" (ou "personne", id 0 dans COCO)
        # On impose aussi une confiance (score) de plus de 50%
        cibles = [d for d in detections if d.category == 0 and d.conf > 0.50]
        
        if cibles:
            # 🎯 L'ASTUCE : Trouver la plus grande Bounding Box (largeur * hauteur)
            cible_principale = max(cibles, key=lambda d: d.box.width * d.box.height)
            
            # Récupération des coordonnées de la boîte englobante
            # Attention: avec Picamera2, les coordonnées sont souvent normalisées de 0.0 à 1.0
            box = cible_principale.box
            
            # Calcul du centre (cx, cy)
            cx = box.x + (box.width / 2)
            cy = box.y + (box.height / 2)
            
            # Affichage (Ici, tu peux envoyer cx et cy vers tes moteurs ou ton algorithme de suivi)
            print(f"🎯 Cible verrouillée - Centre X: {cx:.3f}, Y: {cy:.3f} | Confiance: {cible_principale.conf*100:.1f}%")
        
        # Légère pause pour ne pas inonder la console (l'IA traite à ~30 FPS)
        time.sleep(0.03)

except KeyboardInterrupt:
    print("\nArrêt demandé par l'utilisateur.")
finally:
    # On libère proprement la caméra
    picam2.stop()
    picam2.close()