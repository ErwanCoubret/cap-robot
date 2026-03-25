import lgpio

# CONFIGURATION PI 5
GPIO_PIN = 18 # 6e pin en haut à partir de la gauche 
CHIP = 4 # Correspond à /dev/gpiochip4 sur le Pi 5 (GPIOs 0-27)

h = None
try:
    h = lgpio.gpiochip_open(CHIP)
    
    # On réserve le pin en tant que sortie
    err = lgpio.gpio_claim_output(h, GPIO_PIN)
    if err < 0:
        print(f"Erreur : Impossible de réserver le pin (Code {err})")
        exit(1)
    # ----------------------------------
    
    print("--- Mode LGPIO Direct (Pi 5) : CONNECTÉ ---")

    def set_pos(p):
        # p entre -1 (gauche) et 1 (droite)
        # Pulse width : 1000us à 2000us
        width = 1500 + (p * 500)
        
        # tx_pwm envoie le signal. On ignore l'erreur éventuelle ici pour la fluidité,
        # mais on pourrait vérifier si ça renvoie < 0
        lgpio.tx_pwm(h, GPIO_PIN, 50, (width / 20000.0) * 100.0)

    # On initialise au milieu
    set_pos(0.5)
    
except KeyboardInterrupt:
    print("\nArrêt demandé par l'utilisateur.")
except Exception as e:
    print(f"Erreur : {e}")
finally:
    if h is not None:
        # On coupe le signal et on libère le pin proprement
        lgpio.tx_pwm(h, GPIO_PIN, 0, 0)
        lgpio.gpio_free(h, GPIO_PIN) # Optionnel mais propre
        lgpio.gpiochip_close(h)
        print("Pin 18 libéré proprement.")