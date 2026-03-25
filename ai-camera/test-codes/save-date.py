import time
from pathlib import Path
from picamera2 import Picamera2

# Configuration
INTERVAL_SEC = 0.3          # Temps entre deux captures
NUM_IMAGES_PER_RUN = 5      # Nombre d'images à chaque lancement
SAVE_DIR = Path("./images") # Dossier de sauvegarde

# Création du dossier s'il n'existe pas
SAVE_DIR.mkdir(parents=True, exist_ok=True)

# Initialisation de la caméra
print("⌛ Initialisation de la caméra... (cela peut prendre quelques secondes)")
# On utilise la configuration d'aperçu pour une capture rapide
# (on n'a pas besoin de l'IA ici, juste de prendre des photos !)
picam2 = Picamera2(camera_num=0)
config = picam2.create_still_configuration(main={"size": (640, 480)}) # Résolution légère, suffisant pour le MCT
picam2.configure(config)
picam2.start()

print("👀 Caméra active !")
print(f"🎯 Prêt à capturer {NUM_IMAGES_PER_RUN} images à {INTERVAL_SEC}s d'intervalle.")
print("POSITIONNE-TOI DEVANT LA CAMÉRA MAINTENANT !")
time.sleep(2) # Laisse 2 secondes pour se préparer

# Calcul du numéro de départ pour le nom de fichier
# On scanne le dossier pour ne pas écraser les images existantes
existing_ids = [int(p.stem.split('_')[1]) for p in SAVE_DIR.glob("img_*.jpg")]
next_id = max(existing_ids) + 1 if existing_ids else 0

# Capture
try:
    for i in range(NUM_IMAGES_PER_RUN):
        filename = SAVE_DIR / f"img_{next_id:04d}.jpg"
        print(f"📸 Capture de l'image {i+1}/{NUM_IMAGES_PER_RUN} -> {filename}")
        
        # Capture de l'image (jpeg)
        picam2.capture_file(str(filename))
        
        # Nom de fichier incrémental
        next_id += 1
        
        # Pause si ce n'est pas la dernière image
        if i < NUM_IMAGES_PER_RUN - 1:
            time.sleep(INTERVAL_SEC)

    print(f"✅ Terminé ! Tu as capturé {NUM_IMAGES_PER_RUN} nouvelles images.")
    print(f"Dossier '{SAVE_DIR}' contient actuellement {len(list(SAVE_DIR.glob('img_*.jpg')))} images.")

except KeyboardInterrupt:
    print("\n🛑 Arrêt du script demandé.")
finally:
    # Nettoyage
    picam2.stop()
    picam2.close()
    print("Connexion caméra fermée.")