import time
from picamera2 import Picamera2
from picamera2.devices.imx500 import IMX500

MODEL_PATH = "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/yolov8n-face.rpk/network.rpk"

print("Chargement du modèle Lindevs (Post-process intégré)...")
imx500 = IMX500(MODEL_PATH)

picam2 = Picamera2(imx500.camera_num)
config = picam2.create_video_configuration(main={"size": (640, 480), "format": "YUV420"})
picam2.configure(config)
picam2.start()

# On récupère la taille du modèle (probablement 640) pour normaliser
mw, mh = imx500.get_input_size()

print(f"🎯 Robot prêt ! Modèle détecté : {mw}x{mh}")

try:
    while True:
        metadata = picam2.capture_metadata()
        data = metadata.get('CnnOutputTensor')
        
        # On vérifie qu'on a bien notre liste de 1801 éléments
        if data is not None and len(data) == 1801:
            nb_detections = int(data[0])
            
            if nb_detections > 0:
                # On va chercher les infos de la première détection (la plus sûre)
                # X est à l'index 1, Y à l'index 301, Score à l'index 1201
                score = data[1201]
                
                if score > 0.40:
                    # Les coordonnées sont souvent en pixels du modèle (ex: 0 à 640)
                    # On les divise par la taille du modèle pour avoir du 0.0 à 1.0
                    cx_pixel = data[1]
                    cy_pixel = data[301]
                    
                    cx = cx_pixel / mw
                    cy = cy_pixel / mh
                    
                    print(f"🎯 VISAGE ! X: {cx:.3f} Y: {cy:.3f} | Score: {score*100:.1f}%")
            
        time.sleep(0.01)

except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    picam2.stop()
    picam2.close()