# OpenRouter — ancien moteur

OpenRouter a été testé pour l’analyse visuelle, mais les appels ont été bloqués dans le navigateur par `ERR_BLOCKED_BY_CLIENT`. Il n’est donc plus appelé par le formulaire d’inscription.

La fonction `analyser-article-openrouter` reste conservée dans le dépôt pour éviter une suppression inutile de code, mais le moteur actif est désormais Cloudflare Workers AI. Consulter [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) pour la configuration actuelle.
