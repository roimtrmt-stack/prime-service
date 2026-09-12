# Contrôle historique — ancien traitement de fond

Ce fichier documente une ancienne version du pipeline qui appliquait un fond blanc. Cette version est retirée et ne doit plus être utilisée.

Le pipeline actuel conserve le fond, les ombres et l’éclairage d’origine. Il applique uniquement l’orientation EXIF, le redimensionnement proportionnel et une compression contrôlée, avec un test de fidélité dans `tests/test-image-optimizer-fidelity.ts`.
