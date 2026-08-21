# Cloudflare Workers AI pour le nommage automatique

Prime Service utilise désormais Cloudflare Workers AI comme moteur principal lorsque le vendeur laisse le champ « Nom de l’article » vide. Le modèle par défaut est `@cf/llava-hf/llava-1.5-7b-hf`, un modèle image-to-text hébergé par Cloudflare. Le moteur local gratuit reste la relève automatique.

## Ordre de fonctionnement

1. La photo est envoyée dans le bucket `photos-articles`.
2. Prime Service appelle l’Edge Function Supabase `analyser-article-cloudflare`.
3. La fonction récupère la photo côté serveur, la convertit en base64 et l’envoie à Cloudflare Workers AI.
4. Le modèle propose un nom court de 2 à 5 mots en français.
5. Si les secrets manquent, si l’allocation quotidienne est épuisée, si Cloudflare renvoie une erreur ou si la réponse est inutilisable, le moteur local gratuit reprend automatiquement.

## Configuration manuelle

1. Créer ou ouvrir un compte sur [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Ouvrir **Workers AI**, choisir **Use REST API**, puis créer un **Workers AI API Token**.
3. Copier aussi l’**Account ID** du compte Cloudflare.
4. Dans Supabase, ouvrir le projet `kfxalpvbtbvkncztjwzc`, puis **Project Settings → Edge Functions → Secrets**.
5. Ajouter `CLOUDFLARE_ACCOUNT_ID` avec l’Account ID.
6. Ajouter `CLOUDFLARE_API_TOKEN` avec le token Workers AI.
7. Facultatif : ajouter `CLOUDFLARE_AI_MODEL=@cf/llava-hf/llava-1.5-7b-hf`.
8. Ne mettre ces valeurs ni dans HTML, ni dans JavaScript public, ni dans GitHub.

Après l’ajout des deux secrets, aucune modification du site ne sera nécessaire : la fonction active les lira automatiquement. Le niveau gratuit Cloudflare fournit actuellement 10 000 Neurons par jour. Si cette allocation est dépassée, les appels externes échouent et le fallback local continue de publier l’article sans bloquer.

## Confidentialité et limites

Lorsque les secrets sont configurés, la photo est envoyée à Cloudflare. Si vous ne voulez aucune transmission externe, ne configurez pas les secrets : le moteur local gratuit fonctionnera seul. Le modèle LLaVA peut produire des descriptions moins précises qu’un modèle vision haut de gamme ; le nom généré doit donc être contrôlé par le vendeur.

## Sources officielles

- [Tarifs et allocation gratuite Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [API REST Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)
- [Modèle LLaVA image-to-text](https://developers.cloudflare.com/workers-ai/models/llava-1.5-7b-hf/)
