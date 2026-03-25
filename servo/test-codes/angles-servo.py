import lgpio
import time

# CONFIGURATION PI 5
GPIO_PIN = 18 
CHIP = 4 

h = None
try:
    h = lgpio.gpiochip_open(CHIP)
    
    # On réserve le pin en tant que sortie
    err = lgpio.gpio_claim_output(h, GPIO_PIN)
    if err < 0:
        print(f"Erreur : Impossible de réserver le pin (Code {err})")
        exit(1)
    
    print("--- Mode LGPIO Direct (Pi 5) : CONNECTÉ ---")

    def set_pos(p):
        # p théoriquement entre -1 (gauche) et 1 (droite)
        width = 1500 + (p * 500)
        
        if width < 400 or width > 2600:
            print("Valeur extrême ignorée pour protéger le matériel.")
            return

        # 1. On envoie le signal pour faire bouger le servo
        lgpio.tx_pwm(h, GPIO_PIN, 50, (width / 20000.0) * 100.0)
        
        # 2. On attend une demi-seconde pour lui laisser le temps physiquement d'arriver à destination
        # (Si vous faites de grands mouvements, vous pouvez augmenter à 0.8 ou 1.0)
        time.sleep(0.5) 
        
        # 3. ON COUPE LE SIGNAL POUR TUER LE JITTER
        lgpio.tx_pwm(h, GPIO_PIN, 0, 0)

    # On initialise au milieu
    set_pos(0)
    print("Servo centré (0).")

    # --- LA BOUCLE INTERACTIVE ---
    while True:
        choix = input("Entrez un angle (ex: -1.0, 0.5, 1.2) ou 'q' pour quitter : ")
        
        if choix.lower() == 'q':
            break
            
        try:
            angle = float(choix)
            set_pos(angle)
            print(f"-> Signal envoyé pour la position : {angle}")
        except ValueError:
            print("Erreur : Veuillez entrer un nombre valide.")

except KeyboardInterrupt:
    print("\nArrêt demandé par l'utilisateur.")
except Exception as e:
    print(f"Erreur inattendue : {e}")
finally:
    if h is not None:
        # On coupe le signal et on libère le pin proprement
        lgpio.tx_pwm(h, GPIO_PIN, 0, 0)
        lgpio.gpio_free(h, GPIO_PIN)
        lgpio.gpiochip_close(h)
        print("Pin 18 libéré proprement. Fin du programme.")