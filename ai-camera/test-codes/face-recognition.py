import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

# On importe le décodeur pour transformer les Tenseurs en Objets
from picamera2.devices.imx500.yolov8 import Yolov8PostProcessor

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement du modèle et du décodeur...")
imx500 = IMX500(MODEL_PATH)

# ✨ NOUVEAU : On crée le traducteur pour YOLOv8
# On lui donne les infos du modèle pour qu'il sache comment interpréter les chiffres
post_processor = Yolov8PostProcessor(imx500.get_input_size())

picam2 = Picamera2(imx500.camera_num)
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"})
picam2.configure(config)
picam2.start()

print("Analyse en cours... (Place ton visage devant la caméra !)")

try:
    while True:
        metadata = picam2.capture_metadata()
        
        # ✨ L'ASTUCE : On traduit le Tenseur brut en liste de détections
        # On cherche 'CnnOutputTensor' dans les métadonnées pour le transformer
        raw_tensor = metadata.get('CnnOutputTensor')
        if raw_tensor is not None:
            # Le post-processeur crée la liste 'ObjectDetect' à la volée
            detections = post_processor.process(raw_tensor)
            
            # Maintenant, ton filtre habituel va fonctionner !
            cibles = [d for d in detections if d.conf > 0.40]
            
            if cibles:
                cible = max(cibles, key=lambda d: d.box.width * d.box.height)
                cx = cible.box.x + (cible.box.width / 2)
                cy = cible.box.y + (cible.box.height / 2)
                print(f"🎯 VISAGE DÉTECTÉ ! Centre: {cx:.2f}, {cy:.2f} | Confiance: {cible.conf*100:.1f}%")
        
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()