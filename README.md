# Retouche Vocale

Extension Brave / Chrome / Chromium pour faire relire visuellement un site **à la voix** :
tu navigues en parlant, tu captures des zones d'un clic long, et tout est exporté
dans un format que Claude Code sait exploiter directement.

![icône](assets/icon.svg)

## Fonctionnalités
- **Dictée continue** : le micro enregistre toute la session, sur toutes les pages, sans coupure entre les changements de page (relance automatique si le micro décroche, alerte visible sinon).
- **Capture de zone** : clic long (≈ ⅓ s sans bouger) puis glisser ; capture au relâchement, avec les dimensions affichées. `Échap` annule. Les clics normaux ne sont pas affectés.
- **Contexte pour le code** : chaque capture liste les éléments qu'elle contient (sélecteurs CSS + texte), les clics et les changements de page (y compris en SPA) sont horodatés.
- **Export en un clic** : `~/Téléchargements/retouches-visuelles/<date>/` + prompt pour Claude Code copié dans le presse-papiers.
- **Transcription locale** (Whisper via `transcrire.py`) : rien ne part sur Internet.

## Installation
1. `brave://extensions` → activer le **Mode développeur**.
2. **Charger l'extension non empaquetée** → dossier `extension/`.
3. Une page d'accueil s'ouvre : clique sur **Autoriser le micro** et choisis l'option permanente (pas « cette fois »).

L'identifiant de l'extension est fixe (`hfilcjapjemboanihfobbmoblppcehfb`, grâce au champ `key` du manifeste) :
l'autorisation du micro survit aux mises à jour et aux déplacements du dossier.

### Sur Windows
1. Installer **Python 3.12 ou plus récent** depuis <https://www.python.org/downloads/> (cocher *Add python.exe to PATH*).
   ffmpeg est facultatif : sans lui, l'audio est décodé par PyAV.
2. Récupérer le projet :
   ```
   git clone https://github.com/Kidoly/retouche-vocale.git
   ```
   (mise à jour plus tard : `git pull`, puis ↻ sur l'extension dans `chrome://extensions`)
3. Dans Chrome / Edge / Brave : Mode développeur → *Charger l'extension non empaquetée* → dossier `retouche-vocale\extension`.
4. Autoriser le micro sur la page d'accueil qui s'ouvre.

Si le PC est géré par l'entreprise, le mode développeur peut être bloqué par une stratégie : il faut alors demander à l'IT d'autoriser l'extension (ID `hfilcjapjemboanihfobbmoblppcehfb`).

## Utilisation
| Action | Comment |
|---|---|
| Démarrer / arrêter | icône de l'extension, ou `Alt+Maj+R` |
| Capturer une zone | clic long puis glisser |
| Couper le micro, exporter, arrêter | boutons de la barre flottante |
| Réglages | clic droit sur l'icône → *Options* |

Ensuite, colle le prompt copié dans Claude Code : il lance `python3 transcrire.py` dans le dossier d'export
(installe faster-whisper dans `~/.cache/retouche-vocale/venv` au premier lancement), lit `notes.md` et les captures, puis applique les retouches.

## Développement
```
extension/        code de l'extension (chargée telle quelle)
  background.js   état de session, captures, export, pilotage du micro
  offscreen.js    enregistrement audio (document invisible, survit aux navigations)
  content.js      barre flottante, sélection de zone, journal des clics
  transcrire.py   copié dans chaque export : transcription + génération de notes.md
assets/           sources des icônes (SVG)
scripts/build.sh  construit dist/*.zip (Web Store) et dist/*.crx (signé)
keys/             clé de signature — NE PAS PUBLIER (ignorée par git)
```

Publier une version : augmenter `version` dans `extension/manifest.json`, noter les changements dans `CHANGELOG.md`, puis `./scripts/build.sh`.

Régénérer les icônes après modification de `assets/icon.svg` :
```
for s in 16 32 48 128; do rsvg-convert -w $s -h $s assets/icon.svg -o extension/icons/icon-$s.png; done
for s in 16 32 48; do rsvg-convert -w $s -h $s assets/icon-off.svg -o extension/icons/icon-off-$s.png; done
```
