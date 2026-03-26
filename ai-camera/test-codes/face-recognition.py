import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500
# On utilise le nom exact trouvé avec ta commande dir()
from picamera2.devices.imx500 import postprocess_yolov8

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement du modèle IMX500...")
imx500 = IMX500(MODEL_PATH)
# On récupère la taille d'entrée (ex: 640, 640) pour le décodeur
model_size = imx500.get_input_size()

picam2 = Picamera2(imx500.camera_num)
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"})
picam2.configure(config)
picam2.start()

print(f"🎯 IA prête ! Taille modèle : {model_size}. Cherchons des visages...")

try:
    while True:
        metadata = picam2.capture_metadata()
        raw_tensor = metadata.get('CnnOutputTensor')
        
        if raw_tensor is not None:
            # ✨ LA MAGIE : On appelle la fonction directe
            # Elle nous renvoie une liste d'objets avec .box et .conf
            detections = postprocess_yolov8(raw_tensor, model_size=model_size, conf_threshold=0.4)
            
            if detections:
                # On prend la plus grosse détection (le visage le plus proche)
                cible = max(detections, key=lambda d: d.box.width * d.box.height)
                
                # Coordonnées (0.0 à 1.0)
                cx = cible.box.x + (cible.box.width / 2)
                cy = cible.box.y + (cible.box.height / 2)
                
                print(f"🎯 VISAGE TROUVÉ ! X: {cx:.3f} Y: {cy:.3f} | Confiance: {cible.conf*100:.1f}%")
            else:
                # Optionnel : décommenter pour voir quand l'IA bosse mais ne voit rien
                # print("... scan en cours ...")
                pass
        
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt du robot.")
finally:
    picam2.stop()
    picam2.close()