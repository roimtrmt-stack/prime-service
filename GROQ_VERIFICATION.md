# Vérification Groq Vision — 21 août 2026

## Sources officielles consultées

- Vision et modèles multimodaux : https://console.groq.com/docs/vision
- Limites du plan gratuit : https://console.groq.com/docs/rate-limits
- Modèles disponibles : https://console.groq.com/docs/models
- Facturation : https://console.groq.com/docs/billing-faqs

## Résultats

Groq propose un endpoint compatible OpenAI pour analyser des images avec `chat.completions`. La documentation officielle indique que le modèle vision `qwen/qwen3.6-27b` accepte les images via URL publique ou base64, prend en charge le mode JSON et est destiné à l’analyse visuelle et aux descriptions d’articles.

La page officielle des limites liste `qwen/qwen3.6-27b` dans le Free Plan avec 30 RPM, 1 000 RPD, 8 000 TPM et 200 000 TPD. Ces limites sont des quotas de débit, non une garantie illimitée ; Groq peut modifier les limites et le modèle est indiqué comme modèle de prévisualisation dans la page des modèles. Le niveau Developer est payant et demande un moyen de paiement, mais il n’est pas nécessaire pour rester sur le Free Plan.

## Décision technique

Remplacer l’appel Gemini par une Edge Function Supabase `analyser-article-groq` utilisant le modèle `qwen/qwen3.6-27b`, avec la clé uniquement dans le secret serveur `GROQ_API_KEY`. Envoyer à Groq une URL publique Supabase strictement limitée au bucket `photos-articles`, demander un JSON contenant `nom` et `confiance`, et limiter la sortie. En cas de clé absente, erreur 401/403, quota 429, dépassement de taille, délai ou sortie invalide, le frontend doit utiliser le moteur local gratuit déjà présent.

## Limites et confidentialité

La photo envoyée via URL publique est récupérée par Groq. L’image doit rester dans un format et une taille compatibles avec les limites du fournisseur. Le site ne doit pas activer de facturation Groq ni inclure la clé dans GitHub Pages. Si aucun secret `GROQ_API_KEY` n’est défini, aucun appel externe ne doit être tenté avec une clé vide et le fallback local doit fonctionner.
