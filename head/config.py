import serial
import time

# Configuration du port série (Vérifie que c'est bien le bon port)
ARDUINO_PORT = '/dev/ttyACM0'
BAUD_RATE = 9600

print(f"🔌 Tentative de connexion à l'Arduino sur {ARDUINO_PORT}...")

try:
    # Ouverture du port série
    arduino = serial.Serial(ARDUINO_PORT, BAUD_RATE, timeout=1)
    
    # L'ouverture du port série provoque souvent un redémarrage (reset) de l'Arduino.
    # On fait une petite pause de 2 secondes pour lui laisser le temps de s'allumer.
    time.sleep(2) 
    print("✅ Connexion réussie ! L'Arduino est prêt à recevoir des commandes.")
    print("---------------------------------------------------------")
    print("👉 Instructions :")
    print("Tape les coordonnées X et Y séparées par un espace (ex: 150 120)")
    print("Tape 'q' pour quitter le programme.")
    print("---------------------------------------------------------")

    while True:
        # On demande à l'utilisateur d'entrer une commande
        choix = input("🎯 Coordonnées (X Y) : ")
        
        # Condition de sortie
        if choix.lower() == 'q':
            break
            
        try:
            # On sépare l'entrée en deux valeurs (X et Y)
            valeurs = choix.split()
            if len(valeurs) != 2:
                print("⚠️ Erreur : Il faut exactement deux nombres séparés par un espace.")
                continue
                
            x = int(valeurs[0])
            y = int(valeurs[1])
            
            # Création de la trame attendue par le Serial.parseInt() de ton Arduino
            # On ajoute bien le \n (retour à la ligne) à la fin
            trame = f"{x} {y}\n"
            
            # Envoi des données encodées en octets (UTF-8)
            arduino.write(trame.encode('utf-8'))
            print(f"🚀 Trame envoyée : {trame.strip()}")
            
        except ValueError:
            print("⚠️ Erreur : Veuillez entrer uniquement des nombres entiers.")

except serial.SerialException as e:
    print(f"❌ Erreur de connexion au port série : {e}")
    print("Astuce : Vérifie que le câble USB est branché et que le port est correct.")
    print("Tape 'ls /dev/ttyACM*' ou 'ls /dev/ttyUSB*' dans le terminal pour vérifier le nom du port.")
except KeyboardInterrupt:
    print("\n🛑 Arrêt demandé.")
finally:
    # On ferme proprement le port série à la fin
    if 'arduino' in locals() and arduino.is_open:
        arduino.close()
        print("✅ Port série fermé proprement.")