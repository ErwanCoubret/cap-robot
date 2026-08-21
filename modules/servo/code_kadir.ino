/*
 * ============================================================
 *  TEST SERVOS SG90 - Cou de robot (YAW + PITCH)
 *  Carte : Arduino Nano (ATmega328P)
 *  Moniteur série : 115200 bauds, fin de ligne "Nouvelle ligne"
 * ============================================================
 *
 *  CABLAGE
 *    Servo YAW   : signal -> D9   | Vcc -> +5V externe | GND -> GND
 *    Servo PITCH : signal -> D10  | Vcc -> +5V externe | GND -> GND
 *    IMPORTANT : la masse (GND) de l'alim externe DOIT etre reliee
 *    au GND du Nano (masse commune), sinon le signal n'est pas vu.
 *
 *  COMMANDES (taper dans le moniteur serie puis Entree)
 *    y120        -> place le YAW a 120 deg
 *    p60         -> place le PITCH a 60 deg
 *    c           -> retour au centre memorise
 *    z           -> definit la position ACTUELLE comme nouveau centre
 *    s           -> balayage lent min <-> max (test mecanique)
 *    l y 30 150  -> change les butees du yaw (min=30, max=150)
 *    l p 40 140  -> change les butees du pitch
 *    d           -> detache les servos (plus de couple, on peut bouger a la main)
 *    a           -> rattache les servos
 *    ?           -> affiche l'etat courant (a recopier dans le code)
 * ============================================================
 */

#include <Servo.h>

// ---------- Configuration ----------
const uint8_t PIN_YAW   = 8;
const uint8_t PIN_PITCH = 7;

const int STEP_DELAY = 15;   // ms par degre : plus grand = mouvement plus lent

struct Limits { int minDeg; int maxDeg; int center; };

// Valeurs de depart PRUDENTES : on evite 0 et 180 tant que la mecanique
// n'est pas validee (le SG90 force contre ses butees internes = il chauffe).
Limits limYaw   = { 0, 180, 90 };
Limits limPitch = { 0, 180, 90 };

// ---------- Etat interne ----------
Servo servoYaw, servoPitch;
int posYaw, posPitch;
bool attached = false;

// ---------- Fonctions utilitaires ----------
void attachAll() {
  servoYaw.attach(PIN_YAW);
  servoPitch.attach(PIN_PITCH);
  servoYaw.write(posYaw);
  servoPitch.write(posPitch);
  attached = true;
  Serial.println(F("[OK] Servos attaches"));
}

void detachAll() {
  servoYaw.detach();
  servoPitch.detach();
  attached = false;
  Serial.println(F("[OK] Servos detaches (couple relache)"));
}

// Deplacement degre par degre : evite les a-coups qui font sauter les pignons
void moveSlow(Servo &s, int &pos, const Limits &lim, int target, const char *name) {
  int clamped = constrain(target, lim.minDeg, lim.maxDeg);
  if (clamped != target) {
    Serial.print(F("[!] "));
    Serial.print(name);
    Serial.print(F(" limite a "));
    Serial.println(clamped);
  }
  int step = (clamped > pos) ? 1 : -1;
  while (pos != clamped) {
    pos += step;
    s.write(pos);
    delay(STEP_DELAY);
  }
  Serial.print(F("[>] "));
  Serial.print(name);
  Serial.print(F(" = "));
  Serial.println(pos);
}

void printState() {
  Serial.println(F("---------- ETAT ----------"));
  Serial.print(F("YAW   pos=")); Serial.print(posYaw);
  Serial.print(F("  min=")); Serial.print(limYaw.minDeg);
  Serial.print(F("  max=")); Serial.print(limYaw.maxDeg);
  Serial.print(F("  centre=")); Serial.println(limYaw.center);
  Serial.print(F("PITCH pos=")); Serial.print(posPitch);
  Serial.print(F("  min=")); Serial.print(limPitch.minDeg);
  Serial.print(F("  max=")); Serial.print(limPitch.maxDeg);
  Serial.print(F("  centre=")); Serial.println(limPitch.center);
  Serial.println(F("--------------------------"));
}

void sweepTest() {
  Serial.println(F("[..] Balayage YAW"));
  moveSlow(servoYaw, posYaw, limYaw, limYaw.minDeg, "YAW");
  delay(400);
  moveSlow(servoYaw, posYaw, limYaw, limYaw.maxDeg, "YAW");
  delay(400);
  moveSlow(servoYaw, posYaw, limYaw, limYaw.center, "YAW");

  Serial.println(F("[..] Balayage PITCH"));
  moveSlow(servoPitch, posPitch, limPitch, limPitch.minDeg, "PITCH");
  delay(400);
  moveSlow(servoPitch, posPitch, limPitch, limPitch.maxDeg, "PITCH");
  delay(400);
  moveSlow(servoPitch, posPitch, limPitch, limPitch.center, "PITCH");
  Serial.println(F("[OK] Balayage termine"));
}

// ---------- Traitement des commandes ----------
void handleCommand(String cmd) {
  cmd.toLowerCase();
  char c = cmd.charAt(0);
  String arg = cmd.substring(1);
  arg.trim();

  switch (c) {
    case 'y':
      if (arg.length()) moveSlow(servoYaw, posYaw, limYaw, arg.toInt(), "YAW");
      else Serial.println(F("[X] usage: y<angle>  ex: y120"));
      break;

    case 'p':
      if (arg.length()) moveSlow(servoPitch, posPitch, limPitch, arg.toInt(), "PITCH");
      else Serial.println(F("[X] usage: p<angle>  ex: p60"));
      break;

    case 'c':
      moveSlow(servoYaw, posYaw, limYaw, limYaw.center, "YAW");
      moveSlow(servoPitch, posPitch, limPitch, limPitch.center, "PITCH");
      break;

    case 'z':
      limYaw.center = posYaw;
      limPitch.center = posPitch;
      Serial.println(F("[OK] Nouveau centre memorise"));
      printState();
      break;

    case 's':
      sweepTest();
      break;

    case 'd':
      detachAll();
      break;

    case 'a':
      attachAll();
      break;

    case 'l': {
      char buf[40];
      char j;
      int a, b;
      cmd.toCharArray(buf, sizeof(buf));
      if (sscanf(buf, "l %c %d %d", &j, &a, &b) == 3 && a < b) {
        a = constrain(a, 0, 180);
        b = constrain(b, 0, 180);
        if (j == 'y') { limYaw.minDeg = a;  limYaw.maxDeg = b; }
        else          { limPitch.minDeg = a; limPitch.maxDeg = b; }
        Serial.println(F("[OK] Butees mises a jour"));
        printState();
      } else {
        Serial.println(F("[X] usage: l y 30 150"));
      }
      break;
    }

    case '?':
      printState();
      break;

    default:
      Serial.println(F("[X] Commande inconnue (tape ? pour l'etat)"));
  }
}

// ---------- Setup / Loop ----------
void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }

  // On demarre AU CENTRE, jamais aux extremes
  posYaw   = limYaw.center;
  posPitch = limPitch.center;
  attachAll();

  Serial.println();
  Serial.println(F("=== TEST SERVOS SG90 - YAW / PITCH ==="));
  Serial.println(F("Commandes : y<deg> p<deg> c z s d a ? | l y 30 150"));
  printState();
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) handleCommand(line);
  }
}
