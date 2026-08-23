# Vérification publique — compression fidèle sans remplacement de fond

Le 23 août 2026, la page `https://roimtrmt-stack.github.io/prime-service/?photo-pipeline=natural-1` a été chargée après le déploiement GitHub Pages. La page publique est accessible et affiche les catégories du catalogue.

Le script servi est `photo-optimizer.js?v=natural-1`. Une lecture sans cache de ce fichier confirme la présence de `preparerImageUploadFidele`, l’absence de `fillRect`, `fillStyle`, `fondSortie` et `imageFondBlanc`, et l’absence de l’ancien suffixe `white-1`.
