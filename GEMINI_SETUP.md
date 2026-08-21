# Gemini Vision pour le nommage automatique

Prime Service utilise Gemini Vision uniquement lorsque le vendeur laisse le champ « Nom de l’article » vide. La clé Gemini n’est jamais placée dans les pages GitHub Pages : elle est lue uniquement par l’Edge Function Supabase `analyser-article-gemini` depuis le secret serveur `GEMINI_API_KEY`.

## Ordre de fonctionnement

1. La photo est envoyée dans le bucket public `photos-articles`.
2. Prime Service appelle `analyser-article-gemini` avec l’URL publique contrôlée de cette photo.
3. Gemini reçoit une consigne stricte et renvoie seulement un nom court et une confiance.
4. Si Gemini répond correctement, son nom est utilisé et stylisé par Prime Service.
5. Si la clé est absente, si le quota gratuit est atteint, si Google renvoie une erreur, si le délai est dépassé ou si la réponse est inutilisable, Prime Service conserve automatiquement le moteur gratuit local déjà présent. La publication ne doit donc pas être bloquée par Gemini.

## Action manuelle à effectuer

1. Ouvrir [Google AI Studio — API keys](https://aistudio.google.com/api-keys).
2. Créer ou sélectionner un projet Google et créer une clé Gemini.
3. Laisser le projet au **Free Tier** si aucune facturation n’est souhaitée. Les quotas gratuits sont limités et peuvent changer ; ne pas activer la facturation simplement pour ce test.
4. Dans Supabase, ouvrir le projet `kfxalpvbtbvkncztjwzc`, puis **Project Settings → Edge Functions → Secrets**.
5. Ajouter le secret `GEMINI_API_KEY` avec la clé créée. Ne pas ajouter la clé dans HTML, JavaScript public, GitHub ou ce fichier.
6. Facultatif : ajouter `GEMINI_VISION_MODEL=gemini-3.7-flash`. Si cette variable est absente, la fonction utilise cette même valeur par défaut.
7. Publier ou redéployer la fonction `analyser-article-gemini` depuis le workflow de déploiement Supabase.

## Contrôle du coût

Le niveau gratuit ne garantit ni un quota illimité ni une disponibilité permanente. Le site ne lance pas automatiquement une recharge et ne contient aucune carte bancaire. Lorsque le quota ou la limite de débit est atteint, le moteur local gratuit prend la relève. Pour rester sans risque de paiement, ne pas lier de compte de facturation au projet Gemini et surveiller les limites dans Google AI Studio.

## Limite de confidentialité

La photo est envoyée à Google lorsque Gemini est configuré. Si le propriétaire ne souhaite pas cette transmission, il suffit de ne pas définir `GEMINI_API_KEY` : Prime Service utilisera automatiquement l’analyse locale gratuite de couleur, luminosité et cadrage.
