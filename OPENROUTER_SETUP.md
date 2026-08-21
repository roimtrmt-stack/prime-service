# OpenRouter Free Models Router pour le nommage automatique

Prime Service utilise désormais OpenRouter comme moteur principal lorsque le vendeur laisse le champ « Nom de l’article » vide. L’Edge Function `analyser-article-openrouter` envoie la photo au routeur gratuit OpenRouter, qui sélectionne un modèle disponible capable d’analyser les images. Le moteur local gratuit reste la relève automatique.

## Ordre de fonctionnement

1. La photo est envoyée dans le bucket `photos-articles`.
2. Prime Service appelle `analyser-article-openrouter` avec une URL Supabase contrôlée.
3. La fonction récupère la photo côté serveur, la convertit en base64 et l’envoie au routeur `openrouter/free`.
4. Le modèle vision sélectionné propose un nom court et une confiance.
5. Si la clé est absente, si le quota est atteint, si le routeur est indisponible ou si la réponse est invalide, le moteur local gratuit reprend automatiquement. La publication continue sans bloquer.

## Configuration manuelle

1. Ouvrir [OpenRouter Keys](https://openrouter.ai/keys) et créer une clé API.
2. Ne pas ajouter de crédit et ne pas activer de facturation si vous voulez rester sur les modèles gratuits.
3. Dans Supabase, ouvrir le projet `kfxalpvbtbvkncztjwzc`, puis **Project Settings → Edge Functions → Secrets**.
4. Ajouter le secret `OPENROUTER_API_KEY` avec la clé OpenRouter.
5. Ajouter facultativement `OPENROUTER_VISION_MODEL` avec la valeur `openrouter/free`. Cette valeur est déjà utilisée par défaut si le secret de modèle est absent.
6. Aucun changement supplémentaire du code n’est nécessaire après l’ajout du secret : la fonction active lit le secret à chaque appel.

## Gratuité et limites

La documentation OpenRouter indique que le Free Models Router est gratuit et sélectionne des modèles gratuits compatibles avec les capacités demandées. Les modèles gratuits peuvent avoir des limites de débit, une disponibilité variable et une qualité variable. OpenRouter peut modifier la liste des modèles gratuits. Le site n’effectue aucune recharge automatique et ne contient aucune carte bancaire.

## Confidentialité

La photo est transmise à OpenRouter lorsque `OPENROUTER_API_KEY` est configurée. Si cette transmission n’est pas souhaitée, ne définissez pas le secret : le moteur local gratuit continuera de produire un nom à partir des aspects visuels simples de la photo.
