import time
import numpy as np
import serial
import lgpio

from modlib.apps import Annotator
from modlib.devices import AiCamera
from modlib.models import COLOR_FORMAT, MODEL_TYPE, Model
from modlib.models.post_processors import pp_od_yolo_ultralytics

# ==========================================
# 1. CONFIGURATION ARDUINO (Port Série)
# ==========================================
# ⚠️ Remplace par ton vrai port (ex: /dev/ttyUSB0 ou /dev/ttyACM0)
ARDUINO_PORT = '/dev/ttyACM0' 
BAUD_RATE = 9600

try:
    arduino = serial.Serial(ARDUINO_PORT, BAUD_RATE, timeout=0.1)
    print(f"🔌 Connecté à l'Arduino sur {ARDUINO_PORT}")
except Exception as e:
    print(f"⚠️ Erreur Arduino : {e} (Le code continuera sans l'écran)")
    arduino = None

# ==========================================
# 2. CONFIGURATION SERVO (LGPIO)
# ==========================================
GPIO_PIN = 18 
CHIP = 4 
h = lgpio.gpiochip_open(CHIP)
lgpio.gpio_claim_output(h, GPIO_PIN)

current_servo_pos = -1  # Position initiale

def update_servo(p):
    """Envoie le signal PWM sans bloquer (pas de sleep, pas de coupure)"""
    if p < -1.8 or p > 0:
        return # Sécurité matérielle respectée
    width = 1500 + (p * 500)
    lgpio.tx_pwm(h, GPIO_PIN, 50, (width / 20000.0) * 100.0)

# ==========================================
# 3. CONFIGURATION IA (Modlib)
# ==========================================
class YOLO(Model):
    def __init__(self):
        super().__init__(
            model_file="/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/packerOut.zip", 
            model_type=MODEL_TYPE.CONVERTED,
            color_format=COLOR_FORMAT.RGB,
            preserve_aspect_ratio=False,
        )
        try:
            self.labels = np.genfromtxt(
                "/home/erwan/cap-robot/ai-camera/models/yolov8n-face-lindevs_imx_model/labels.txt", 
                dtype=str, delimiter="\n"
            )
        except OSError:
            self.labels = ["Visage"]

    def post_process(self, output_tensors):
        return pp_od_yolo_ultralytics(output_tensors)

# ==========================================
# 4. PARAMÈTRES DE TRACKING & MAPPING
# ==========================================
# ⚠️ Remplace par la résolution réelle de ton IA (ex: 640x480)
CAM_WIDTH = 640  
CAM_HEIGHT = 480 

# Dimensions de l'écran TFT Arduino
TFT_WIDTH = 320
TFT_HEIGHT = 240

# Sensibilité du moteur (Proportionnel)
# Si le robot oscille (tremble) -> baisse cette valeur
# Si le robot est trop lent -> augmente cette valeur
KP = 0.002 

print("🤖 Initialisation de l'AI Camera (via modlib)...")
device = AiCamera(frame_rate=2) 
model = YOLO()
device.deploy(model)

print("🎯 IA déployée avec succès ! Lancement du tracking global...")
update_servo(current_servo_pos) # On centre le moteur au démarrage

try:
    with device as stream:
        for frame in stream:
            valid_detections = frame.detections[frame.detections.confidence > 0.55]
            
            if len(valid_detections) > 0:
                # On ne prend que le premier visage détecté
                bbox, score, class_id, _ = valid_detections[0]
                x_min, y_min, x_max, y_max = bbox
                
                # Centre du visage dans la caméra
                cx = (x_min + x_max) / 2
                cy = (y_min + y_max) / 2
                
                # -----------------------------------------------------
                # A. ENVOI À L'ARDUINO (Mouvement des yeux)
                # -----------------------------------------------------
                if arduino and arduino.is_open:
                    # Règle de trois : on adapte l'échelle Caméra -> Écran Arduino
                    target_x = int((cx / CAM_WIDTH) * TFT_WIDTH)
                    target_y = int((cy / CAM_HEIGHT) * TFT_HEIGHT)
                    
                    # On crée la chaîne exacte attendue par tes Serial.parseInt()
                    trame = f"{target_x} {target_y}\n"
                    arduino.write(trame.encode('utf-8'))
                
                # -----------------------------------------------------
                # B. CONTRÔLE DU SERVO (Suivi de la tête)
                # -----------------------------------------------------
                # Calcul de l'erreur : où est le visage par rapport au milieu de l'image ?
                erreur_x = (CAM_WIDTH / 2) - cx 
                
                # On met à jour la position du moteur proportionnellement à l'erreur
                # (Note : inverse le signe "+=" en "-=" si le moteur tourne dans le mauvais sens !)
                current_servo_pos -= erreur_x * KP
                
                # On empêche le code de dépasser tes limites de sécurité [-1.8, 0]
                current_servo_pos = max(-1.8, min(0.0, current_servo_pos))
                
                update_servo(current_servo_pos)
                
                print(f"🎯 X:{cx:.1f} Y:{cy:.1f} | ⚙️ Servo:{current_servo_pos:.2f}")
                
except KeyboardInterrupt:
    print("\n🛑 Arrêt demandé par l'utilisateur.")
except Exception as e:
    print(f"❌ Erreur inattendue : {e}")
finally:
    # On ferme tout très proprement pour ne pas bloquer les ports
    if arduino and arduino.is_open:
        arduino.close()
    lgpio.tx_pwm(h, GPIO_PIN, 0, 0)
    lgpio.gpio_free(h, GPIO_PIN)
    lgpio.gpiochip_close(h)
    print("✅ Port Série et Broches GPIO libérés. Fin du programme.")