# Gemini Vision — ancien moteur

Prime Service utilisait auparavant Gemini Vision pour le nommage automatique. Après les tests, l’inscription utilise désormais Groq Vision comme moteur principal, avec le moteur local gratuit comme relève.

La fonction `analyser-article-gemini` reste déployée temporairement pour éviter de supprimer du code utile sans validation, mais elle n’est plus appelée par le formulaire d’inscription. Aucun secret `GEMINI_API_KEY` n’est nécessaire pour le fonctionnement actuel.

Pour la configuration active, consulter [GROQ_SETUP.md](GROQ_SETUP.md).
