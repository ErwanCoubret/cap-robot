# Plan de test sur le robot — session suivante

Objectif : valider tout **sauf la caméra et le haut-parleur**, qui ne sont pas
testables aujourd'hui. La caméra doit simplement rester absente sans rien
casser ailleurs.

## Contexte pour la prochaine session

- Le code est sur la branche `claude/cap-robot-os-agentic-2c7hw4`.
- Architecture, API du daemon et lancement : [`docs/architecture.md`](architecture.md).
- **Modèle de transcription installé : `dimavz/whisper-tiny:latest`** (via
  Ollama, sur la machine `LLM`). Il faut donc basculer la transcription de
  `mock` vers `local` — c'est le premier point du plan.
- Pas de servos (hors périmètre), caméra volontairement non testée.

## 0. Installation

```bash
cd ~/cap-robot && git pull
./deploy/install.sh
systemctl status capd cap-ui
```

Attendu : les deux services `active (running)`.

```bash
curl -s http://127.0.0.1:8790/status | jq
```

Attendu : `capabilities.mic = true`, `capabilities.eyes = true`,
`capabilities.tts = "supertonic"`. `camera` et `speaker` peuvent être `false`,
c'est le sujet du test 6.

## 1. Brancher la transcription locale (à faire en premier)

Dans `.env` :

```bash
CAP_STT_PROVIDER=local
CAP_STT_BASE_URL=http://LLM:11434/v1
CAP_STT_MODEL=dimavz/whisper-tiny:latest
```

Puis `sudo systemctl restart cap-ui` et vérifier le log de démarrage :

```bash
journalctl -u cap-ui -n 20 | grep "stt="
```

Attendu : `stt=local model=dimavz/whisper-tiny:latest url=http://LLM:11434/v1`.

**Point d'attention :** Ollama n'expose pas forcément
`/v1/audio/transcriptions` comme Whisper. Si l'appel échoue, relever
l'erreur exacte (`journalctl -u cap-ui -f` pendant une dictée) et vérifier
avec un `curl` direct :

```bash
curl -s http://LLM:11434/v1/audio/transcriptions \
  -F model=dimavz/whisper-tiny:latest \
  -F file=@/tmp/test.wav | head -c 300
```

Si la route n'existe pas, c'est une adaptation à faire dans
`ui-cap/infrastructure/ai/sttAdapter.ts` (le reste du pipeline est déjà bon) —
et le repli `CAP_STT_PROVIDER=mock` permet de continuer les autres tests.

## 2. Micro et transcription (le cœur du test)

1. Écran d'accueil → **Note vocale** → **Dicter**.
2. Parler ~3 secondes : « Rappelle-moi d'acheter du pain demain matin ».
3. **Terminer**.

Vérifier à l'écran l'enchaînement : `Je t'écoute…` → `Je transcris…` →
`J'enregistre ta note…` → la transcription affichée entre guillemets.

Contrôles utiles :

```bash
# le wav capturé existe et n'est pas vide
ls -la ~/.cap/recordings/ | tail -3
aplay ~/.cap/recordings/<dernier>.wav   # si un casque est branché
```

Cas limites à passer :
- appuyer sur **Terminer** immédiatement → « Je n'ai rien entendu. »
- **Annuler** pendant l'écoute → rien n'est enregistré, aucun fichier ajouté.
- parler dans le vide / très bas → « Je n'ai rien compris. »

## 3. Flots (appairage, notes, tâches)

1. **Réglages → Appairer** → se connecter à Flots sur l'écran du robot.
2. Retour automatique sur Réglages avec « Connecté » et l'email du compte.
3. **Tester la connexion** → nombre d'outils et latence affichés.

Puis :
- refaire une **note vocale** → elle doit apparaître dans Flots, titrée
  « Note vocale du <date> à <heure> ».
- **Parler** → « Crée une tâche acheter du pain » → la tâche apparaît dans Flots.
- **Ma journée** → les tâches du jour se chargent, celles en retard en rouge.
- Taper une tâche → confirmation → **Terminer** → elle disparaît de la liste.
- **Réinitialiser la connexion** → retour à « Non appairé », puis ré-appairer.

## 4. Agent et modèle local

```bash
curl -s -X POST http://127.0.0.1:3000/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"text":"Quelle heure est-il ?"}'
```

Attendu : une phrase courte en français. Si le modèle est injoignable, le
message doit nommer l'endpoint (`Ollama (local) ne répond pas (http://LLM:11434/v1)`).

À tester ensuite à la voix, via **Parler** :
- « Quelle heure est-il ? » → appelle `get_current_datetime`.
- « Réveille-moi à 7h30 tous les jours » → crée l'alarme, visible dans Alarmes.
- « Qu'est-ce que j'ai aujourd'hui ? » → répond depuis le cache de la journée.
- « Supprime toutes mes tâches » → **doit refuser** : le robot n'a pas le droit
  de supprimer. C'est le test de sécurité important.

Pendant chaque tour, l'écran doit afficher les étapes (« Je crée la tâche… »).

## 5. Alarmes

1. **Alarmes → +** → régler l'heure à la minute suivante → **Tous les jours** →
   Enregistrer.
2. Attendre : l'écran doit basculer en plein écran bleu avec l'heure.
3. **+5 min** → l'alarme repart 5 minutes plus tard, la quotidienne est
   conservée.
4. Refaire, puis **Arrêter**.
5. Pendant qu'une alarme sonne, recharger la page (F5 ou redémarrer
   `cap-kiosk`) : **l'alarme doit toujours s'afficher** — c'est un bug corrigé,
   il mérite d'être revérifié sur le vrai matériel.
6. Laisser une alarme sonner sans y toucher 2 minutes : elle doit s'arrêter
   seule, et une alarme suivante doit pouvoir sonner.

## 6. Matériel absent (caméra et son)

Sans caméra branchée :
- **Réglages** affiche « Caméra non détectée », les deux interrupteurs sont
  désactivés, aucune erreur en boucle dans `journalctl -u capd -f`.
- Le reste de l'interface fonctionne normalement.

Sans haut-parleur : les réponses de Cap s'affichent à l'écran même si rien ne
sort. Vérifier qu'aucune étape ne reste bloquée en attendant l'audio.

Yeux (si l'ESP32 est branché) : **Réglages → Test yeux** doit faire bouger la
pupille.

## 7. Redémarrage complet

```bash
sudo reboot
```

Attendu au retour : le kiosk revient tout seul en plein écran, les alarmes
créées sont toujours là, l'appairage Flots aussi, et « Ma journée » se
resynchronise.

## Ce qui est déjà validé hors robot

Inutile de le refaire : 330 tests passent (119 côté daemon, 211 côté
interface), le pipeline vocal complet a été exercé de bout en bout avec les
adaptateurs simulés, et l'appairage OAuth a été vérifié contre
`api-staging.flots.app` (découverte, enregistrement dynamique, PKCE S256).

Ce qui n'a **jamais** tourné sur du vrai matériel : la caméra IMX500, le lien
série vers les yeux, la capture micro réelle, Supertonic sur ARM, et le modèle
Ollama. C'est exactement le périmètre de ce plan.
