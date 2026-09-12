# Vérification publique — publication multi-produit

Le 26 août 2026, la page publique `https://roimtrmt-stack.github.io/prime-service/?multi-product-fix=298413c` a été chargée après le déploiement du commit `298413c`. Les catégories sont accessibles et affichent notamment 85 articles dans « Vêtements, bijoux & accessoires », 10 dans « Beauté & hygiène » et 13 dans « Appareils électroniques ».

Une lecture sans cache de `inscription.html` confirme que le parcours actif contient le message indiquant que chaque photo sélectionnée devient une ligne distincte et ne contient plus les appels `fusionner_stock_si_meme_boutique` ni `trouverArticleEquivalent`. Le module photo naturel est également servi avec `preparerImageUploadFidele`.
