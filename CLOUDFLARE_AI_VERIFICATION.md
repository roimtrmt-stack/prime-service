# Vérification Cloudflare Workers AI — 21 août 2026

## Sources officielles

- Tarifs et allocation gratuite : https://developers.cloudflare.com/workers-ai/platform/pricing/
- API REST : https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- Modèle LLaVA image-to-text : https://developers.cloudflare.com/workers-ai/models/llava-1.5-7b-hf/
- Catalogue des modèles : https://developers.cloudflare.com/workers-ai/models/

## Résultats

Cloudflare Workers AI propose une API REST côté serveur et une allocation gratuite de 10 000 Neurons par jour. Les opérations qui dépassent cette allocation échouent si aucun plan payant n’est activé ; aucun paiement automatique n’est donc nécessaire pour rester dans le gratuit.

Le catalogue comprend des modèles vision hébergés par Cloudflare, notamment `@cf/meta/llama-3.2-11b-vision-instruct`, `@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/google/gemma-4-26b-a4b-it` et le modèle image-to-text `@cf/llava-hf/llava-1.5-7b-hf`. La page du modèle LLaVA confirme qu’il accepte une chaîne binaire représentant l’image et produit du texte. Pour le nommage d’articles, `@cf/meta/llama-3.2-11b-vision-instruct` est adapté à la reconnaissance visuelle, au captioning et aux questions sur une image.

L’API REST nécessite un compte Cloudflare, un API Token Workers AI et un Account ID. L’endpoint suit la forme `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL}`. Les deux secrets doivent rester côté Edge Function Supabase.

## Décision technique

Cloudflare Workers AI est une alternative serveur adaptée pour éviter les appels directs OpenRouter bloqués dans le navigateur. Prime Service peut envoyer la photo récupérée depuis Supabase en binaire/base64 à une Edge Function `analyser-article-cloudflare`, qui appelle Cloudflare. Si le secret manque, si l’allocation gratuite quotidienne est épuisée, si Cloudflare renvoie une erreur ou si la sortie est inutilisable, le moteur local gratuit reprend automatiquement.

## Limites

L’allocation gratuite est quotidienne et partagée par le compte. Les limites et les modèles peuvent évoluer. La clé Cloudflare et l’Account ID sont indispensables pour l’activation ; le site ne doit jamais les exposer. Le traitement envoie la photo à Cloudflare lorsque les secrets sont configurés.
