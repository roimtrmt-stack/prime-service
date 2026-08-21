# Groq Vision pour le nommage automatique

Prime Service utilise Groq Vision lorsque le vendeur laisse le champ « Nom de l’article » vide. Le modèle utilisé par défaut est `qwen/qwen3.6-27b`, qui accepte une photo et le mode JSON. La clé est lue uniquement par l’Edge Function Supabase `analyser-article-groq` et n’est jamais placée dans GitHub Pages.

## Ordre de fonctionnement

1. La photo est envoyée dans le bucket public `photos-articles`.
2. Prime Service appelle `analyser-article-groq` avec l’URL publique contrôlée de cette photo.
3. Groq analyse l’image et renvoie un nom commercial court ainsi qu’un niveau de confiance.
4. Le nom est stylisé puis enregistré dans l’article.
5. Si la clé manque, si Groq renvoie `429`, si le délai est dépassé, si le modèle est indisponible ou si la réponse est invalide, le moteur local gratuit prend automatiquement la relève. La publication n’est donc pas bloquée.

## Action manuelle à effectuer

1. Ouvrir [Groq Console](https://console.groq.com/).
2. Créer un compte ou se connecter, puis créer une clé API dans la section **API Keys**.
3. Rester sur le **Free Plan**. Ne pas passer au Developer Plan si vous ne voulez pas ajouter de moyen de paiement.
4. Dans Supabase, ouvrir le projet `kfxalpvbtbvkncztjwzc`, puis **Project Settings → Edge Functions → Secrets**.
5. Ajouter `GROQ_API_KEY` avec la clé Groq. Ne pas écrire cette clé dans HTML, JavaScript public, GitHub ou ce document.
6. Facultatif : ajouter `GROQ_VISION_MODEL=qwen/qwen3.6-27b`.
7. Tester une inscription avec une photo et le champ Nom vide.

La page officielle Groq liste ce modèle vision dans le Free Plan avec des limites de débit et de tokens. Ces quotas peuvent changer et ne sont pas illimités. Le site ne recharge aucun crédit automatiquement. Une fois la limite atteinte, le moteur local gratuit est utilisé.

## Confidentialité et limite

La photo est transmise à Groq lorsque `GROQ_API_KEY` est configurée. Si vous ne souhaitez aucune transmission externe, ne définissez pas ce secret : le nommage local gratuit continuera de fonctionner.

Le mode gratuit peut être limité à environ 1 000 requêtes par jour et 200 000 tokens par jour pour ce modèle selon les limites affichées par Groq au moment de la vérification. Il faut toujours se fier au tableau de limites du compte, car le fournisseur peut le modifier.
