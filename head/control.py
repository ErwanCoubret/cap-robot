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

last_servo_move_time = time.time()
pwm_active = False
last_sent_pos = -999.0  

try:
    with device as stream:
        for frame in stream:
            valid_detections = frame.detections[frame.detections.confidence > 0.55]
            
            # ==========================================
            # 1. GESTION DU VISAGE
            # ==========================================
            if len(valid_detections) > 0:
                
                # Ta boucle magique
                for bbox, score, class_id, _ in valid_detections:
                    x_min, y_min, x_max, y_max = bbox
                    
                    # Coordonnées Normalisées et Effet Miroir
                    cx_norm = 1.0 - ((x_min + x_max) / 2)
                    cy_norm = (y_min + y_max) / 2
                    
                    cx = cx_norm * CAM_WIDTH
                    cy = cy_norm * CAM_HEIGHT
                    
                    # --- A. YEUX ARDUINO ---
                    if arduino and arduino.is_open:
                        target_x = int((cx / CAM_WIDTH) * TFT_WIDTH)
                        target_y = int((cy / CAM_HEIGHT) * TFT_HEIGHT)
                        arduino.write(f"{target_x} {target_y}\n".encode('utf-8'))
                    
                    # --- B. TRAVELLING MOTEUR (BEAUCOUP PLUS RAPIDE) ---
                    # 🔥 Vitesse multipliée par 4 (Tu peux monter à 0.15 si c'est encore trop lent)
                    SERVO_STEP = 0.12  
                    new_pos = current_servo_pos
                    
                    if cx_norm < 0.30:
                        new_pos -= SERVO_STEP
                    elif cx_norm > 0.70:
                        new_pos += SERVO_STEP
                        
                    # 🛡️ ANTI-JITTER MATHÉMATIQUE : On arrondit à 2 décimales 
                    # pour ignorer les micro-variations invisibles du type -1.4533 vs -1.4534
                    new_pos = round(max(-1.8, min(0.0, new_pos)), 2)
                    
                    # On n'envoie le signal QUE si la position a vraiment changé
                    if new_pos != last_sent_pos:
                        current_servo_pos = new_pos
                        update_servo(current_servo_pos)
                        
                        last_sent_pos = current_servo_pos
                        last_servo_move_time = time.time() # On relance le chrono
                        pwm_active = True
                        
                        print(f"🎯 Zone: {cx_norm*100:.0f}% | ⚙️ Servo: {current_servo_pos:.2f}")
                        
                    break # On traite un seul visage par frame
            
            # ==========================================
            # 2. ANTI-JITTER MATÉRIEL (La méthode forte)
            # ==========================================
            # Si le signal est actif MAIS qu'on n'a pas bougé depuis 0.3s -> Coupe-circuit !
            if pwm_active and (time.time() - last_servo_move_time > 0.3):
                
                # 1. On coupe la fréquence
                lgpio.tx_pwm(h, GPIO_PIN, 0, 0)
                
                # 2. ⚡ On force la broche électriquement à 0 Volt (LOW)
                lgpio.gpio_write(h, GPIO_PIN, 0)
                
                pwm_active = False
                print("💤 Broche 18 forcée à LOW (Moteur totalement coupé)")

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