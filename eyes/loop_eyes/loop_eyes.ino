#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_GC9A01A.h>

// Broches ESP32 (Mode Hardware SPI Ultra-Rapide)
#define TFT_CS   5
#define TFT_DC   2
#define TFT_RST  4
Adafruit_GC9A01A tft(TFT_CS, TFT_DC, TFT_RST);

// Création du "Mini-Canvas" de 128x128 pixels (32 Ko)
GFXcanvas16 miniCanvas(128, 128);

// Couleurs
#define COLOR_WHITE  0xFFFF  // Blanc total (Globe)
#define COLOR_PUPIL  0x2169  // Bleu foncé #232B49 (Pupille)
#define COLOR_EYELID 0x633F  // Violet #615FFF (Paupières)

// Dimensions
const int CENTER_X = 120;
const int CENTER_Y = 120;
const int PUPIL_RADIUS = 60;

// Variables de position de la pupille
float currentX = 120.0;
float currentY = 120.0;
float targetX = 120.0;
float targetY = 120.0;

float lastX = 120.0;
float lastY = 120.0;

// Mouvement lent et doux
const float SMOOTHING = 0.08; 

// --- GESTION DE LA SEQUENCE AUTOMATIQUE ---
int waypoints[3][2] = {
  {120, 120},  // Centre
  {168, 65},   // Haut-Droit
  {65, 100}    // Haut-Gauche
};
int currentWaypoint = 0;          

// --- TIMERS INDEPENDANTS ---
unsigned long lastMoveTime = 0;   
const unsigned long DELAY_BETWEEN_MOVES = 1000; // Changement de position toutes les 1s

unsigned long lastBlinkTime = 0;
const unsigned long BLINK_INTERVAL = 1600;      // Clignement toutes les 3s

// --- VARIABLES DU CLIGNEMENT ---
bool isBlinking = false;
bool isClosing = false;
float lidProgress = 0.0; // De 0.0 (ouvert) à 1.0 (fermé)
int lastLidY = 0;

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(0);

  if (!miniCanvas.getBuffer()) {
    Serial.println("ERREUR CRITIQUE : RAM insuffisante !");
    while(1) delay(100); 
  }

  // Affichage initial
  tft.fillScreen(COLOR_WHITE);
  tft.fillCircle(CENTER_X, CENTER_Y, PUPIL_RADIUS, COLOR_PUPIL);

  Serial.println("Sequence de mouvement (1s) et Clignement (3s) lances !");
}

void loop() {
  unsigned long now = millis();

  // 1. GESTION DU MOUVEMENT (Indépendant)
  if (now - lastMoveTime >= DELAY_BETWEEN_MOVES) {
    currentWaypoint = (currentWaypoint + 1) % 3; 
    targetX = waypoints[currentWaypoint][0];
    targetY = waypoints[currentWaypoint][1];
    
    lastMoveTime = now;
  }

  // 2. DECLENCHEMENT DU CLIGNEMENT (Indépendant, toutes les 3s)
  if (!isBlinking && (now - lastBlinkTime >= BLINK_INTERVAL)) {
    isBlinking = true;
    isClosing = true;
    lidProgress = 0.0;
    lastBlinkTime = now; // On reset le chrono du clignement
  }

  // 3. ANIMATION DU CLIGNEMENT
  if (isBlinking) {
    if (isClosing) {
      lidProgress += 0.12; // Vitesse de fermeture
      if (lidProgress >= 1.0) {
        lidProgress = 1.0;
        isClosing = false; // Commence à rouvrir
      }
    } else {
      lidProgress -= 0.10; // Vitesse d'ouverture
      if (lidProgress <= 0.0) {
        lidProgress = 0.0;
        isBlinking = false; // Clignement terminé
      }
    }
  }

  // 120 pixels est la moitié de l'écran (fermeture totale au centre)
  int curLidY = (int)(lidProgress * 120);

  // 4. GLISSEMENT DE LA PUPILLE
  currentX += (targetX - currentX) * SMOOTHING;
  currentY += (targetY - currentY) * SMOOTHING;

  int curX_int = (int)currentX;
  int curY_int = (int)currentY;
  int lastX_int = (int)lastX;
  int lastY_int = (int)lastY;

  // 5. MOTEUR DE RENDU HYBRIDE (Delta Redraw + Mini-Canvas)
  if (curX_int != lastX_int || curY_int != lastY_int || curLidY != lastLidY) {
    
    // --- ETAPE A : Dessiner les paupières directement sur l'écran ---
    if (curLidY != lastLidY) {
      if (curLidY > lastLidY) {
        // Fermeture
        tft.fillRect(0, lastLidY, 240, curLidY - lastLidY, COLOR_EYELID);
        tft.fillRect(0, 240 - curLidY, 240, curLidY - lastLidY, COLOR_EYELID);
      } else {
        // Ouverture (on efface en blanc)
        tft.fillRect(0, curLidY, 240, lastLidY - curLidY, COLOR_WHITE);
        tft.fillRect(0, 240 - lastLidY, 240, lastLidY - curLidY, COLOR_WHITE);
      }
    }

    // --- ETAPE B : Préparer le Mini-Canvas pour la pupille ---
    int screenX = (curX_int + lastX_int) / 2 - 64; 
    int screenY = (curY_int + lastY_int) / 2 - 64;

    miniCanvas.fillScreen(COLOR_WHITE); 
    
    int localX = curX_int - screenX;
    int localY = curY_int - screenY;
    miniCanvas.fillCircle(localX, localY, PUPIL_RADIUS, COLOR_PUPIL);

    // --- ETAPE C : Superposer les paupières dans le Mini-Canvas ---
    if (curLidY > screenY) {
      int h = curLidY - screenY;
      if (h > 128) h = 128;
      miniCanvas.fillRect(0, 0, 128, h, COLOR_EYELID);
    }
    
    int bottomLidY = 240 - curLidY;
    if (bottomLidY < screenY + 128) {
      int localY_lid = bottomLidY - screenY;
      if (localY_lid < 0) localY_lid = 0;
      miniCanvas.fillRect(0, localY_lid, 128, 128 - localY_lid, COLOR_EYELID);
    }

    // --- ETAPE D : Envoi à l'écran ---
    tft.drawRGBBitmap(screenX, screenY, miniCanvas.getBuffer(), 128, 128);
    
    lastX = currentX;
    lastY = currentY;
    lastLidY = curLidY;
  }
}