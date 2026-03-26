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
    # 🛠️ CORRECTION : On force la conversion en Float Python standard
    p = float(p) 
    
    if p < -1.8 or p > 0:
        return # Sécurité matérielle respectée
        
    width = 1500 + (p * 500)
    
    duty_cycle = float((width / 20000.0) * 100.0)
    
    lgpio.tx_pwm(h, GPIO_PIN, 50, duty_cycle)

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
                
                for bbox, score, class_id, _ in valid_detections:
                    x_min, y_min, x_max, y_max = bbox
                    
                    # 1. RÉCUPÉRATION DES COORDONNÉES NORMALISÉES (0.0 à 1.0)
                    cx_norm = (x_min + x_max) / 2
                    cy_norm = (y_min + y_max) / 2
                    
                    # 2. CONVERSION EN PIXELS RÉELS (0 à 640 / 0 à 480)
                    cx = cx_norm * CAM_WIDTH
                    cy = cy_norm * CAM_HEIGHT
                    
                    # -----------------------------------------------------
                    # A. ENVOI À L'ARDUINO (Mouvement des yeux)
                    # -----------------------------------------------------
                    if arduino and arduino.is_open:
                        # Plus besoin de diviser par CAM_WIDTH ici, un simple produit en croix suffit !
                        target_x = int((cx / CAM_WIDTH) * TFT_WIDTH)
                        target_y = int((cy / CAM_HEIGHT) * TFT_HEIGHT)
                        
                        trame = f"{target_x} {target_y}\n"
                        arduino.write(trame.encode('utf-8'))
                    
                    # -----------------------------------------------------
                    # B. CONTRÔLE DU SERVO (Suivi de la tête) AVEC ANTI-JITTER
                    # -----------------------------------------------------
                    erreur_x = (CAM_WIDTH / 2) - cx 
                    
                    # ZONE MORTE (Deadband) : On ignore les micro-mouvements de moins de 30 pixels
                    # Cela va stopper net les tremblements (jitter) !
                    if abs(erreur_x) > 30:
                        current_servo_pos -= erreur_x * KP
                        # Sécurité des butées
                        current_servo_pos = max(-1.8, min(0.0, current_servo_pos))
                        update_servo(current_servo_pos)
                    
                    print(f"🎯 Pixels-> X:{cx:.1f} Y:{cy:.1f} | ⚙️ Servo:{current_servo_pos:.2f} | Conf: {score*100:.1f}%")
                    
                    # On break pour ne traiter que le premier visage
                    break
                
except KeyboardInterrupt:
    print("\n🛑 Arrêt demandé par l'utilisateur.")
except Exception as e:
    print(f"❌ Erreur inattendue : {e}")
finally:
    if arduino and arduino.is_open:
        arduino.close()
    lgpio.tx_pwm(h, GPIO_PIN, 0, 0)
    lgpio.gpio_free(h, GPIO_PIN)
    lgpio.gpiochip_close(h)
    print("✅ Port Série et Broches GPIO libérés. Fin du programme.")