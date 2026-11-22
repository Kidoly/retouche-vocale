# Changelog

## 1.1.2 — 2026-11-22
- Compatible Windows : chemin d'export, encodage UTF-8, venv Windows, décodage audio sans ffmpeg (PyAV).

## 1.1.1 — 2026-11-22
- Page d'accueil à l'installation : un seul bouton pour autoriser le micro, avec le bon choix indiqué (pas « cette fois »).
- La page d'autorisation ne se ferme plus toute seule (ça retirait l'accès accordé « cette fois »).
- Bouton « Autoriser » dans la barre si le micro est refusé ; plus de lien à copier.

## 1.1.0 — 2026-11-22
- Nouvelle interface : barre flottante avec icônes, chronomètre et compteur de captures ; popup avec statistiques ; page d'options.
- Icône de l'extension (grise à l'arrêt, rouge pendant la session, nombre de captures en badge).
- Dimensions affichées pendant la sélection, assombrissement du reste de la page.
- Options : durée du clic long, journal des clics, position de la barre, modèle Whisper.
- Identifiant d'extension fixe (l'autorisation du micro n'est plus perdue).
- Script de build : `.zip` pour le Web Store et `.crx` signé.

## 1.0.1
- Surveillance du micro toutes les 5 s avec relance automatique et alerte visible.
- Journal de diagnostic du micro dans `session.json`.
- Page d'autorisation permanente du micro.

## 1.0.0
- Première version : dictée, capture par clic long, journal des clics et pages, export, transcription Whisper locale.
